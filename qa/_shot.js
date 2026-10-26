const fs = require('fs');
const { launch, goto, sleep } = require('./lib/cdp');
(async () => {
  const cdp = await launch({ port: 9481 });
  await goto(cdp, 'https://ginkgo-food-map.app.workbuddy.host/?sharecode=YOUR_SHARECODE', 5000);
  await sleep(7000);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('E:/2026-10-24-16-22-22/ginkgo-food-map/qa/live-shot.png', Buffer.from(shot.data, 'base64'));
  console.log('saved');
  await cdp.close(); process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
