// Only presentation changes here: keep the saved words and their order, and use
// headings only when the source explicitly supplies one. Never infer decisions.
function paragraphs(text,language){
 if(text.length<=420)return [text];
 const sentences=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter(language,{granularity:'sentence'}).segment(text)].map(part=>part.segment):[text];
 const parts=[];let current='';
 for(const sentence of sentences){
  if(current&&current.length+sentence.length>420){parts.push(current.trim());current='';}
  if(sentence.length>600){
   for(const word of sentence.split(/\s+/).filter(Boolean)){
    if(current&&current.length+word.length+1>420){parts.push(current.trim());current='';}
    current+=(current?' ':'')+word;
   }
   current+=' ';
  }else current+=sentence;
 }
 if(current.trim())parts.push(current.trim());
 return parts;
}

export function binderSummaryPages(summary,language='en'){
 const blocks=[];let prose=[];
 const flush=()=>{if(prose.length){for(const text of paragraphs(prose.join(' '),language))blocks.push({type:'paragraph',text});prose=[];}};
 for(const raw of summary.replace(/\r\n?/g,'\n').split('\n')){
  const line=raw.trim();
  if(!line){flush();continue;}
  const heading=line.match(/^#{1,6}\s+(.+?)(?:\s+#+)?$/)||line.match(/^\*\*([^*]+)\*\*:?$/)||line.match(/^__([^_]+)__:?$/);
  if(heading||line.length<=90&&line.endsWith(':')&&!/^[-*•]\s/.test(line)){
   flush();blocks.push({type:'heading',text:heading?heading[1]:line});continue;
  }
  const note=line.match(/^[-*•]\s+(.+)$/);
  if(note){flush();for(const text of paragraphs(note[1],language))blocks.push({type:'note',text});}
  else prose.push(line);
 }
 flush();
 const pages=[];let page=[],size=0;
 for(let index=0;index<blocks.length;index++){
  const block=blocks[index],next=blocks[index+1];
  // Keep a heading with the first paragraph it introduces.
  const needed=block.text.length+(block.type==='heading'&&next?next.text.length:0);
  if(page.length&&(size+needed>900||page.length>=4)&&page.at(-1).type!=='heading'){
   pages.push(page);page=[];size=0;
  }
  page.push(block);size+=block.text.length;
 }
 if(page.length)pages.push(page);
 return pages;
}
