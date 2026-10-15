import {jsPDF} from 'jspdf';

// Text is written directly into the PDF, never interpreted as HTML or fetched URLs.
export function binderPdf(data,{now=new Date()}={}){
 const pdf=new jsPDF({unit:'pt',format:'letter',compress:true});
 const width=612,height=792,left=58,right=554,bottom=722;
 const ink=[47,52,59],clay=[164,81,60],muted=[105,98,91];
 const es=data.language==='es',t=(en,sp)=>es?sp:en;
 const clean=value=>String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[\u2010-\u2015]/g,'-').replace(/\u2026/g,'...');
 let y=0;
 function startPage(label){
  if(y)pdf.addPage();
  pdf.setFillColor(252,249,244);pdf.rect(0,0,width,height,'F');
  pdf.setDrawColor(231,220,207);pdf.setLineWidth(.6);pdf.line(44,84,44,bottom);
  pdf.setFont('helvetica','bold');pdf.setFontSize(16);pdf.setTextColor(...clay);pdf.text('origen.',left,42);
  pdf.setFont('helvetica','normal');pdf.setFontSize(9);pdf.setTextColor(...muted);
  const labelLines=pdf.splitTextToSize(clean(label),right-left);pdf.text(labelLines.length>1?labelLines[0]+'...':labelLines[0]||'',left,62);
  pdf.setDrawColor(221,202,185);pdf.line(left,76,right,76);y=103;
 }
 function room(amount,label){if(y+amount>bottom)startPage(label);}
 function text(value,{size=11,bold=false,color=ink,indent=0,gap=9,label=data.title,bullet=false}={}){
  pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(...color);
  const lineHeight=size*1.55;
  const lines=pdf.splitTextToSize(clean(value),right-left-indent-4);
  // Keep short entries together, but split long notes safely over pages.
  if(lines.length*lineHeight<bottom-103)room(lines.length*lineHeight+gap,label);
  pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(...color);
  for(let i=0;i<lines.length;i++){
   if(y+lineHeight>bottom){startPage(label);pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(...color);}
   if(bullet&&i===0){pdf.setFillColor(...clay);pdf.circle(left+3,y-3,1.8,'F');}
   pdf.text(lines[i],left+indent,y);y+=lineHeight;
  }
  y+=gap;
 }
 startPage(data.name);
 text(data.title,{size:26,bold:true,color:clay,gap:8});
 text(data.name,{size:13,gap:12});
 text(`${t('Saved on','Guardado el')} ${now.toLocaleDateString(es?'es-US':'en-US',{dateStyle:'long'})}`,{size:9,color:muted,gap:16});
 text(data.copy,{size:9,color:muted,gap:20});
 if(data.summary){text(t('The big picture','Panorama general'),{size:15,bold:true,gap:12});text(data.summary,{gap:20});}
 for(const [index,topic] of data.topics.entries()){
  if(!topic.sections.length&&data.topics.length>1)continue;
  if(index||data.summary)startPage(topic.title);
  text(topic.title,{size:22,bold:true,color:clay,gap:20,label:topic.title});
  if(!topic.sections.length)text(t('No saved notes in this topic yet.','Aún no hay notas guardadas en este tema.'),{color:muted,label:topic.title});
  for(const section of topic.sections){
   room(85,topic.title);
   text(section.title,{size:13,bold:true,gap:12,label:topic.title});
   if(section.recap)text(t('Collected from your conversations. You can edit these in your binder.','Recopilado de tus conversaciones. Puedes editarlo en tu carpeta.'),{size:9,color:muted,gap:12,label:topic.title});
   for(const entry of section.entries)text(entry.text+(entry.translated?` (${t('translated','traducido')})`:''),{bullet:true,indent:15,label:topic.title,gap:13});
   y+=10;
  }
 }
 text(data.caption,{size:9,color:muted,gap:0});
 const pages=pdf.getNumberOfPages();
 for(let n=1;n<=pages;n++){
  pdf.setPage(n);pdf.setDrawColor(221,202,185);pdf.line(left,744,right,744);
  pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.setTextColor(...muted);
  pdf.text(t('My binder - downloaded copy','Mi carpeta - copia descargada'),left,760);
  pdf.text(`${n} / ${pages}`,right,760,{align:'right'});
 }
 pdf.setProperties({title:data.title,subject:t('Personal binder notes','Notas de mi carpeta'),creator:'Origen'});
 return pdf;
}
