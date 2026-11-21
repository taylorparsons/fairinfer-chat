const heading = document.createElement('h2');
heading.id = 'pottery';
heading.textContent = 'Pottery tours';
const text = document.createElement('p');
text.textContent = 'Each pottery tour lasts 45 minutes.';
document.querySelector('main').prepend(heading, text);
