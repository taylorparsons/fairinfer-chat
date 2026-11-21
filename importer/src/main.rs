use anyhow::{Result, ensure};
use clap::{Parser, Subcommand};
use rmcp::{
    ServerHandler, ServiceExt,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, ContentBlock, ServerCapabilities, ServerConfig},
    tool, tool_handler, tool_router,
};
use serde::Deserialize;
use site_chat_import::{Crawler, DEFAULT_SELECTOR};
use std::{fs::File, io::Read, path::PathBuf, sync::Arc};
use tokio::sync::Mutex;
use url::Url;

#[derive(Parser)]
#[command(about = "Read approved website pages with Selenium and export chat source JSON")]
struct Args {
    #[arg(long)]
    origin: Url,
    #[arg(long, default_value = "http://127.0.0.1:9515/")]
    webdriver: Url,
    #[arg(long)]
    browser_binary: Option<PathBuf>,
    #[arg(long, default_value = DEFAULT_SELECTOR)]
    selector: String,
    #[arg(long)]
    allow_loopback: bool,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Read a file of approved absolute URLs or site-relative paths, one per line.
    Import { urls: PathBuf },
    /// Expose the read_page tool over MCP stdio.
    Mcp { urls: PathBuf },
}

#[derive(Deserialize, schemars::JsonSchema)]
struct ReadPage {
    /// Absolute or site-relative URL within the origin configured at startup.
    url: String,
}

struct ContentServer {
    crawler: Arc<Crawler>,
    approved: Vec<Url>,
    busy: Mutex<()>,
    router: ToolRouter<Self>,
}

#[tool_router]
impl ContentServer {
    #[tool(
        annotations(read_only_hint = true, destructive_hint = false),
        description = "Read the visible main content of an approved page into citation-ready chat JSON. Uses a fresh Selenium browser."
    )]
    async fn read_page(&self, Parameters(input): Parameters<ReadPage>) -> CallToolResult {
        let Ok(_guard) = self.busy.try_lock() else {
            return CallToolResult::error(vec![ContentBlock::text(
                "An extraction is already running.",
            )]);
        };
        match self
            .crawler
            .read_approved_page(&input.url, &self.approved)
            .await
        {
            Ok(bundle) => CallToolResult::success(vec![ContentBlock::text(
                serde_json::to_string(&bundle).expect("knowledge consists of serializable fields"),
            )]),
            Err(error) => CallToolResult::error(vec![ContentBlock::text(error.to_string())]),
        }
    }
}

#[tool_handler(router = self.router.clone())]
impl ServerHandler for ContentServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
    }
}

fn read_urls(urls: PathBuf) -> Result<Vec<String>> {
    let mut input = String::new();
    File::open(urls)?.take(65_537).read_to_string(&mut input)?;
    ensure!(input.len() <= 65_536, "URL list is too large");
    Ok(input
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(str::to_owned)
        .collect())
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let crawler = Crawler::new(
        args.origin,
        args.webdriver,
        args.browser_binary,
        args.selector,
        args.allow_loopback,
    )?;
    match args.command {
        Command::Import { urls } => {
            let pages = read_urls(urls)?;
            let knowledge = crawler.import(&pages).await?;
            println!("{}", serde_json::to_string_pretty(&knowledge)?);
        }
        Command::Mcp { urls } => {
            let approved = crawler.approved_pages(&read_urls(urls)?)?;
            let service = ContentServer {
                crawler: Arc::new(crawler),
                approved,
                busy: Mutex::new(()),
                router: ContentServer::tool_router(),
            }
            .serve(rmcp::transport::stdio())
            .await?;
            service.waiting().await?;
        }
    }
    Ok(())
}
