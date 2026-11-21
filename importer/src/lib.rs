use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    time::Duration,
};
use thirtyfour::prelude::*;
use url::{Host, Url};

const MAX_PAGES: usize = 30;
const MAX_SOURCES: usize = 300;
const MAX_JSON: usize = 900_000;
pub const DEFAULT_SELECTOR: &str = "main, [role=main], article";

pub struct Crawler {
    origin: Url,
    webdriver: Url,
    browser_binary: Option<PathBuf>,
    selector: String,
    allow_loopback: bool,
}

#[derive(Debug, Serialize)]
pub struct Source {
    id: String,
    title: String,
    path: String,
    text: String,
}

#[derive(Debug, Serialize)]
pub struct Knowledge {
    version: u8,
    sources: Vec<Source>,
}

#[derive(Deserialize)]
struct Section {
    title: String,
    anchor: String,
    text: String,
}

fn loopback(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(name)) => name.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(address)) => address.is_loopback(),
        Some(Host::Ipv6(address)) => address.is_loopback(),
        _ => false,
    }
}

fn page_url(url: &Url, allow_loopback: bool) -> Result<()> {
    ensure!(
        url.username().is_empty() && url.password().is_none(),
        "Page URLs cannot contain credentials"
    );
    ensure!(
        url.query().is_none(),
        "Page URLs cannot contain a query string"
    );
    if allow_loopback && loopback(url) && matches!(url.scheme(), "http" | "https") {
        return Ok(());
    }
    ensure!(url.scheme() == "https", "Page URLs require HTTPS");
    let Some(Host::Domain(host)) = url.host() else {
        bail!("Use a public DNS name for the site");
    };
    let host = host.trim_end_matches('.');
    ensure!(
        host.contains('.')
            && ![
                ".local",
                ".localhost",
                ".localdomain",
                ".internal",
                ".test",
                ".invalid"
            ]
            .iter()
            .any(|suffix| host.ends_with(suffix)),
        "Use a public DNS name for the site"
    );
    Ok(())
}

impl Crawler {
    pub fn new(
        origin: Url,
        webdriver: Url,
        browser_binary: Option<PathBuf>,
        selector: String,
        allow_loopback: bool,
    ) -> Result<Self> {
        ensure!(
            webdriver.scheme() == "http"
                && loopback(&webdriver)
                && webdriver.username().is_empty()
                && webdriver.password().is_none()
                && webdriver.path() == "/"
                && webdriver.query().is_none()
                && webdriver.fragment().is_none(),
            "Use a local ChromeDriver HTTP endpoint"
        );
        page_url(&origin, allow_loopback)?;
        ensure!(
            origin.path() == "/" && origin.fragment().is_none(),
            "--origin must be an origin without a page path or fragment"
        );
        ensure!(
            !selector.trim().is_empty() && selector.len() <= 300,
            "Invalid content selector"
        );
        Ok(Self {
            origin,
            webdriver,
            browser_binary,
            selector,
            allow_loopback,
        })
    }

    fn check_page(&self, input: &str) -> Result<Url> {
        ensure!(input.len() <= 2000, "Page URL is too long");
        let mut url = self.origin.join(input).context("Invalid page URL")?;
        page_url(&url, self.allow_loopback)?;
        ensure!(
            url.origin() == self.origin.origin(),
            "Page is outside the approved origin"
        );
        url.set_fragment(None);
        Ok(url)
    }

    pub fn approved_pages(&self, input: &[String]) -> Result<Vec<Url>> {
        ensure!(
            !input.is_empty() && input.len() <= MAX_PAGES,
            "Provide between 1 and {MAX_PAGES} pages"
        );
        let mut seen = HashSet::new();
        let mut pages = Vec::with_capacity(input.len());
        for entry in input {
            let page = self.check_page(entry)?;
            if seen.insert(page.clone()) {
                pages.push(page);
            }
        }
        Ok(pages)
    }

    pub async fn import(&self, input: &[String]) -> Result<Knowledge> {
        self.browse(&self.approved_pages(input)?).await
    }

    pub async fn read_approved_page(&self, input: &str, approved: &[Url]) -> Result<Knowledge> {
        let page = self.check_page(input)?;
        ensure!(
            approved.contains(&page),
            "Page is not in the approved URL file"
        );
        self.browse(&[page]).await
    }

    async fn browse(&self, pages: &[Url]) -> Result<Knowledge> {
        let mut caps = DesiredCapabilities::chrome();
        caps.set_headless()?;
        caps.add_arg("--disable-extensions")?;
        caps.add_arg("--disable-background-networking")?;
        caps.add_arg("--no-first-run")?;
        if let Some(binary) = &self.browser_binary {
            caps.set_binary(
                binary
                    .to_str()
                    .context("Chrome binary path must be UTF-8")?,
            )?;
        }
        let driver = WebDriver::new(self.webdriver.as_str(), caps)
            .await
            .context("Could not reach ChromeDriver")?;
        let result = self.read_pages(&driver, pages).await;
        let quit = driver.quit().await;
        let result = result?;
        quit.context("Could not close the temporary browser")?;
        Ok(result)
    }

    fn require_exact_page(&self, page: &Url, actual: &str) -> Result<Url> {
        let actual = self.check_page(actual).context("Rejected page redirect")?;
        ensure!(
            page == &actual,
            "Rejected page redirect outside the approved URL"
        );
        Ok(actual)
    }

    async fn read_pages(&self, driver: &WebDriver, pages: &[Url]) -> Result<Knowledge> {
        driver
            .set_page_load_timeout(Duration::from_secs(20))
            .await?;
        driver.set_script_timeout(Duration::from_secs(5)).await?;
        let mut sources = Vec::new();
        let mut occurrences: HashMap<(String, String), u32> = HashMap::new();
        let mut seen = HashSet::new();
        for page in pages {
            driver
                .goto(page.as_str())
                .await
                .context("Page did not load")?;
            self.require_exact_page(page, driver.current_url().await?.as_str())?;
            driver
                .query(By::Css(&self.selector))
                .wait(Duration::from_secs(5), Duration::from_millis(150))
                .first()
                .await
                .context("Content selector did not match")?;
            // The URL and text come from the same DOM execution to avoid a client-navigation race.
            let (address, sections): (String, Vec<Section>) = driver
                .execute(
                    concat!(
                        "return [location.href, (function() {",
                        include_str!("extract.js"),
                        "}).apply(null, arguments)];"
                    ),
                    vec![serde_json::json!(self.selector)],
                )
                .await?
                .convert()?;
            let actual = self.require_exact_page(page, &address)?;
            for section in sections {
                let mut citation = actual.clone();
                if !section.anchor.is_empty() {
                    citation.set_fragment(Some(&section.anchor));
                }
                let path: String = citation.into();
                let text = section.text.trim();
                if text.is_empty() || !seen.insert((path.clone(), text.to_owned())) {
                    continue;
                }
                let occurrence = occurrences
                    .entry((path.clone(), section.title.clone()))
                    .or_default();
                let mut digest = Sha256::new();
                digest.update(path.as_bytes());
                digest.update(b"\0");
                digest.update(section.title.as_bytes());
                digest.update(occurrence.to_le_bytes());
                *occurrence += 1;
                let id = digest.finalize()[..12]
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect();
                sources.push(Source {
                    id,
                    title: if section.title.is_empty() {
                        "Published content".to_owned()
                    } else {
                        section.title
                    },
                    path,
                    text: text.to_owned(),
                });
                ensure!(
                    sources.len() <= MAX_SOURCES,
                    "Too many sections for the widget"
                );
            }
        }
        ensure!(
            !sources.is_empty(),
            "No visible content matched the selector"
        );
        let knowledge = Knowledge {
            version: 1,
            sources,
        };
        ensure!(
            serde_json::to_vec_pretty(&knowledge)?.len() <= MAX_JSON,
            "Extracted JSON exceeds the widget limit"
        );
        Ok(knowledge)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn crawler() -> Crawler {
        Crawler::new(
            Url::parse("https://example.org/").unwrap(),
            Url::parse("http://127.0.0.1:9515/").unwrap(),
            None,
            DEFAULT_SELECTOR.to_owned(),
            false,
        )
        .unwrap()
    }

    #[test]
    fn checks_origin_and_public_url_shape() {
        let crawler = crawler();
        assert_eq!(
            crawler.check_page("/help/#hours").unwrap().as_str(),
            "https://example.org/help/"
        );
        for url in [
            "//other.example/help",
            "file:///etc/hosts",
            "https://user@example.org/help",
            "http://example.org/help",
            "/with?auth=secret",
            "https://example.org:444/help",
        ] {
            assert!(crawler.check_page(url).is_err(), "{url}");
        }
        for url in [
            "https://127.0.0.1/",
            "https://[::1]/",
            "https://portal.local/",
        ] {
            assert!(page_url(&Url::parse(url).unwrap(), false).is_err(), "{url}");
        }
    }

    #[tokio::test]
    async fn invalid_inputs_fail_before_driver_request() {
        let crawler = crawler();
        assert!(
            crawler
                .import(&[])
                .await
                .unwrap_err()
                .to_string()
                .contains("between")
        );
        assert!(
            crawler
                .import(&vec!["/".into(); 31])
                .await
                .unwrap_err()
                .to_string()
                .contains("between")
        );
        assert!(
            crawler
                .import(&["https://other.example/".into()])
                .await
                .unwrap_err()
                .to_string()
                .contains("outside")
        );
    }
}
