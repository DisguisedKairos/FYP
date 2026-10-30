// The entry module can fail before app.js installs its own error handling.
// Keep a recoverable screen available when an asset or startup request fails.
const root=document.querySelector('#app');
let expired=false;
function failedStartup() {
  if(!root.querySelector('.initial-loading'))return;
  expired=true;
  document.title='Connection unavailable \u00b7 Green Link Digital Bank';
  const main=document.createElement('main');main.className='connection-error';
  const content=document.createElement('div');
  const logo=document.createElement('img');logo.src='/brand/gldb-logo.svg';logo.alt='Green Link Digital Bank';logo.width=217;logo.height=59;
  const heading=document.createElement('h1');heading.tabIndex=-1;heading.textContent='Let\u2019s try that again.';
  const message=document.createElement('p');message.textContent='The banking app could not finish loading. Check your connection and try again.';
  const retry=document.createElement('button');retry.type='button';retry.className='button';retry.textContent='Try again';retry.addEventListener('click',()=>location.reload());
  content.append(logo,heading,message,retry);main.append(content);root.replaceChildren(main);heading.focus();
}
const deadline=setTimeout(failedStartup,30000);
import('./app.js').then(module=>module.startup).then(()=>{
  clearTimeout(deadline);
  if(root.querySelector('.initial-loading'))failedStartup();
}).catch(()=>{clearTimeout(deadline);if(!expired)failedStartup();});
