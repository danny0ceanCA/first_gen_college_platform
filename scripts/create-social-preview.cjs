// Render the exact brand mark and typography; no generated lettering.
const {createRequire}=require('node:module');
const {writeFileSync}=require('node:fs');
const path=require('node:path');
const sharp=createRequire(process.env.ORIGEN_ASSET_MODULE_ROOT+'/package.json')('sharp');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
 <rect width="1200" height="630" fill="#a4513c"/>
 <rect x="36" y="36" width="1128" height="558" rx="26" fill="none" stroke="#f4eee4" stroke-opacity=".38"/>
 <circle cx="124" cy="145" r="34" fill="none" stroke="#f4eee4" stroke-width="5"/>
 <g fill="#f4eee4" font-family="Arial, sans-serif">
  <text x="179" y="179" font-size="94" font-weight="700" letter-spacing="-5">origen.</text>
  <text x="84" y="300" font-size="53" letter-spacing="-1">Your next chapter.</text>
  <text x="84" y="365" font-size="53" letter-spacing="-1">A path that fits.</text>
  <text x="84" y="444" font-size="27">College &amp; transfer guidance</text>
  <text x="84" y="526" font-size="24">English &amp; Spanish</text>
  <text x="1116" y="526" text-anchor="end" font-size="24">origenedu.ai</text>
 </g>
</svg>`;
const destination=path.resolve(__dirname,'../public/social-preview-terracotta-v1.png');
sharp(Buffer.from(svg)).png().toBuffer().then(buffer=>{writeFileSync(destination,buffer);console.log(destination);}).catch(error=>{console.error(error);process.exitCode=1;});
