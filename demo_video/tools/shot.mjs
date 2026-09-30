import { chromium } from '/home/user/ChainTrace/frontend/node_modules/playwright/index.mjs';
const D='/tmp/claude-0/-home-user-ChainTrace/90241886-fc26-53e4-b44f-427ab377937d/scratchpad/thumb/';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1.5});
await p.goto('file://'+D+'thumb.html');await p.waitForTimeout(500);
await p.screenshot({path:D+'thumb.png'});await b.close();
