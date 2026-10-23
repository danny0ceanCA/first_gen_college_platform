import {jsPDF} from 'jspdf';

// Selectable PDF text only: notes are never interpreted as HTML or fetched URLs.
export function binderPdf(data,{now=new Date()}={}){
 const pdf=new jsPDF({unit:'pt',format:'letter',compress:true});
 const left=82,right=538,bottom=716,ink=[47,52,59],clay=[164,81,60],muted=[105,98,91];
 const colors=[[119,110,86],[99,128,110],[180,119,63],[127,111,150]];
 const es=data.language==='es',t=(en,sp)=>es?sp:en;
 const clean=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[\u2010-\u2015]/g,'-').replace(/\u2026/g,'...');
 let y=0,label=data.title,accent=clay,number='00';
 function short(value,size,max){pdf.setFontSize(size);const original=clean(value);let text=original;while(text&&pdf.getTextWidth(text+'...')>max)text=text.slice(0,-1);return text===original?text:text.trimEnd()+'...';}
 function startPage(nextLabel=label){
  pdf.addPage();label=nextLabel;
  pdf.setFillColor(255,253,247);pdf.rect(0,0,612,792,'F');
  pdf.setFillColor(239,233,220);pdf.rect(0,0,60,792,'F');
  pdf.setDrawColor(214,192,173);pdf.setLineWidth(.6);pdf.line(66,82,66,732);
  for(const cy of [188,396,604]){pdf.setFillColor(223,217,204);pdf.circle(43,cy,9,'F');pdf.setFillColor(250,248,240);pdf.circle(43,cy,5,'F');pdf.setDrawColor(162,159,148);pdf.setLineWidth(2.5);pdf.roundedRect(24,cy-4,27,8,4,4,'S');}
  pdf.setFont('helvetica','bold');pdf.setFontSize(16);pdf.setTextColor(...clay);pdf.text('origen.',left,38);
  pdf.setFont('helvetica','normal');pdf.setTextColor(...muted);pdf.text(short(data.name,9,285),right,37,{align:'right'});
  pdf.setFont('helvetica','bold');pdf.setTextColor(...accent);pdf.text(short(label,10,right-left-36),left,65);
  pdf.setFontSize(10);pdf.text(number,right,65,{align:'right'});
  pdf.setDrawColor(...accent);pdf.setLineWidth(1);pdf.line(left,78,right,78);
  pdf.setFillColor(...accent);pdf.roundedRect(586,104,26,82,5,5,'F');pdf.setFontSize(10);pdf.setTextColor(255,255,255);pdf.text(number,599,147,{align:'center'});y=113;
 }
 function room(amount){if(y+amount>bottom)startPage();}
 function text(value,{size=11,bold=false,color=ink,gap=12,ruled=false,indent=0}={}){
  const font=()=>{pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(...color);};font();
  const lineHeight=ruled?20:size*1.5,lines=pdf.splitTextToSize(clean(value),right-left-indent);
  if(lines.length*lineHeight+gap<bottom-113)room(lines.length*lineHeight+gap);font();
  for(const line of lines){if(y+lineHeight>bottom){startPage();font();}if(ruled){pdf.setDrawColor(231,227,215);pdf.setLineWidth(.4);pdf.line(left,y+5,right,y+5);}pdf.text(line,left+indent,y);y+=lineHeight;}y+=gap;
 }
 function heading(value){room(80);pdf.setFillColor(...accent);pdf.roundedRect(left,y-13,3,21,1,1,'F');text(value,{size:13,bold:true,color:accent,indent:12,gap:14});}
 pdf.setFillColor(...clay);pdf.rect(0,0,612,792,'F');pdf.setFillColor(134,62,44);pdf.rect(0,0,39,792,'F');pdf.setDrawColor(202,135,103);pdf.setLineWidth(.7);pdf.roundedRect(56,22,534,748,12,12,'S');
 pdf.setFont('helvetica','bold');pdf.setFontSize(23);pdf.setTextColor(251,241,220);pdf.text('origen.',82,85);
 pdf.setFontSize(9);pdf.text(t('YOUR COLLEGE JOURNEY','TU CAMINO UNIVERSITARIO'),82,144);
 pdf.setFontSize(34);const titleLines=pdf.splitTextToSize(clean(data.title),440);pdf.text(titleLines,82,195);
 const labelY=Math.max(264,195+titleLines.length*42);
 pdf.setFillColor(245,236,215);pdf.roundedRect(82,labelY,456,108,5,5,'F');pdf.setTextColor(...muted);pdf.setFontSize(8);pdf.text(t('BELONGS TO','PERTENECE A'),100,labelY+24);
 pdf.setFont('times','italic');let nameSize=24;pdf.setFontSize(nameSize);while(pdf.splitTextToSize(clean(data.name),420).length>2&&nameSize>10){nameSize-=1;pdf.setFontSize(nameSize);}pdf.setTextColor(...ink);pdf.text(pdf.splitTextToSize(clean(data.name),420),100,labelY+53);
 pdf.setDrawColor(207,193,166);pdf.line(100,labelY+91,520,labelY+91);
 pdf.setFont('helvetica','normal');pdf.setTextColor(251,241,220);pdf.setFontSize(10);let cy=labelY+145;pdf.text(t('INSIDE YOUR BINDER','EN TU CARPETA'),82,cy);cy+=26;
 const contents=[...(data.summary?[[0,t('The big picture','Panorama general')]]:[]),...data.topics.map((topic,index)=>[index+1,topic.title])];
 for(const [i,item] of contents){pdf.setFontSize(11);pdf.text(`${String(i).padStart(2,'0')}   ${clean(item)}`,82,cy);cy+=24;}
 pdf.setFontSize(9);pdf.text(`${t('Saved on','Guardado el')} ${now.toLocaleDateString(es?'es-US':'en-US',{dateStyle:'long'})}`,82,702);pdf.text(pdf.splitTextToSize(clean(data.copy),440),82,725);
 if(data.summary){startPage(t('The big picture','Panorama general'));text(t('The big picture','Panorama general'),{size:25,bold:true,color:clay,gap:20});text(data.summary,{ruled:true,gap:20});}
 for(const [index,topic] of data.topics.entries()){
  accent=colors[index%colors.length];number=String(index+1).padStart(2,'0');startPage(topic.title);text(topic.title,{size:25,bold:true,color:accent,gap:22});
  if(!topic.sections.length)text(t('Room for your next idea. No saved notes here yet.','Espacio para tu próxima idea. Aún no hay notas guardadas aquí.'),{color:muted,ruled:true});
  for(const section of topic.sections){heading(section.title);if(section.recap)text(t('Conversation notes - revisit and refine as you go.','Notas de conversación - revísalas y ajústalas a tu ritmo.'),{size:9,color:muted,gap:14});const guidance=section.title===t('Coordinator guidance','Orientación de coordinadores');for(const entry of section.entries)text(entry.text+(entry.translated?` (${t('translated','traducido')})`:''),{ruled:true,gap:18,color:guidance?clay:ink});y+=6;}
 }
 room(65);text(data.caption,{size:8,color:muted,gap:0});
 const pages=pdf.getNumberOfPages();for(let n=2;n<=pages;n++){pdf.setPage(n);pdf.setDrawColor(221,202,185);pdf.setLineWidth(.6);pdf.line(left,744,right,744);pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.setTextColor(...muted);pdf.text(t('My binder - downloaded copy','Mi carpeta - copia descargada'),left,761);pdf.text(`${n-1} / ${pages-1}`,right,761,{align:'right'});}
 pdf.setProperties({title:data.title,subject:t('Personal binder notes','Notas de mi carpeta'),creator:'Origen'});return pdf;
}
