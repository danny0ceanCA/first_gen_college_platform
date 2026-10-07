// Stylized dahlia and cempasúchil forms, with embroidered vine rhythms.
// Decorative SVG stays outside the illustration's single-pen drawing sequence.
function Flower({x,y,size,petals=12}:{x:number;y:number;size:number;petals?:number}){
 return <g transform={`translate(${x} ${y}) scale(${size})`}>
  <circle r="27" className="floral-backing"/>
  {Array.from({length:petals},(_,i)=><g key={i} transform={`rotate(${i*360/petals})`}>
   <path className="floral-stroke floral-petal" d={petals===16?'M-4 -23 C-13 -33 -12 -46 -6 -50 Q-8 -59 0 -62 Q8 -59 6 -50 C12 -46 13 -33 4 -23 Q0 -20 -4 -23 Z':'M-4 -23 C-13 -34 -13 -47 0 -63 C13 -47 13 -34 4 -23 Q0 -20 -4 -23 Z'}/>
   <path className="floral-stroke floral-filigree" d="M0 -28 Q-3 -41 0 -53 M-3 -35 Q-7 -39 -7 -44 M3 -35 Q7 -39 7 -44"/>
  </g>)}
  {Array.from({length:10},(_,i)=><path className="floral-stroke floral-inner floral-petal" key={i} transform={`rotate(${i*36+18})`} d="M-3 -11 C-10 -18 -11 -28 0 -36 C11 -28 10 -18 3 -11 Q0 -9 -3 -11 Z"/>)}
  {Array.from({length:10},(_,i)=><path className="floral-stroke floral-engraving" key={i} transform={`rotate(${i*36+18})`} d="M0 -14 Q-3 -22 0 -29 M-3 -18 Q-6 -21 -5 -25 M3 -18 Q6 -21 5 -25"/>)}
  {Array.from({length:16},(_,i)=><path className="floral-stroke floral-engraving" key={i} transform={`rotate(${i*22.5})`} d="M0 -10.5 L0 -12"/>)}
  <path className="floral-stroke" d="M9 0 A9 9 0 1 1 -9 0 A9 9 0 1 1 9 0"/>
  {Array.from({length:12},(_,i)=><path className="floral-stroke floral-seed" key={i} transform={`rotate(${i*30})`} d="M0 -5 L0 -6"/>)}
  <circle r="2.3" className="floral-heart"/>
 </g>;
}
function SeedSprig({x,y,rotation}:{x:number;y:number;rotation:number}){
 return <g transform={`translate(${x} ${y}) rotate(${rotation})`} className="floral-seed-sprig">
  <path className="floral-stroke floral-tendril" d="M0 35 C-7 9 7 -15 0 -42 M-1 13 Q-14 5 -18 -6 M0 1 Q15 -7 17 -17 M2 -14 Q-10 -21 -11 -29"/>
  <path className="floral-stroke floral-petal" d="M0 -42 C-9 -48 -6 -57 -1 -60 C5 -56 8 -48 0 -42 Z M-18 -6 C-29 -9 -29 -19 -25 -24 C-18 -22 -13 -14 -18 -6 Z M17 -17 C13 -27 21 -32 27 -32 C29 -25 25 -17 17 -17 Z M-11 -29 C-21 -33 -21 -40 -17 -45 C-11 -43 -7 -36 -11 -29 Z"/>
  <path className="floral-stroke floral-engraving" d="M0 -45 L-1 -55 M-19 -10 L-24 -20 M19 -20 L24 -28 M-12 -32 L-16 -41"/>
 </g>;
}
function Bud({x,y,rotation=0}:{x:number;y:number;rotation?:number}){
 return <g transform={`translate(${x} ${y}) rotate(${rotation})`}>
  <path className="floral-stroke" d="M0 28 Q7 7 0 -4 M0 0 C-15 -7 -13 -25 -5 -31 Q0 -38 5 -31 C13 -25 15 -7 0 0 M0 -2 Q-4 -19 0 -32 M0 0 Q-12 0 -15 -10 M0 0 Q12 0 15 -10"/>
  <path className="floral-stroke floral-filigree" d="M-6 -6 Q-11 -17 -6 -25 M6 -6 Q11 -17 6 -25"/>
 </g>;
}
export default function StoryFlora(){
 return <div className="story-flora" aria-hidden="true"><svg className="floral-frame floral-frame-left" viewBox="-40 0 270 830" preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
  <g className="floral-spray floral-spray-left">
   <path className="floral-stroke floral-stem" d="M-25 735 C90 660 15 557 104 490 C198 418 19 346 86 247 C124 190 99 128 64 69"/>
   <path className="floral-stroke" d="M86 247 C33 231 10 200 17 167 C57 177 85 208 86 247 M84 251 Q45 200 24 178 M99 283 C130 266 158 268 180 289 C158 315 121 315 99 283 M105 285 Q141 292 170 289 M73 359 C29 360 -1 332 -2 303 C35 306 60 328 73 359 M67 352 L8 312 M107 475 C144 425 176 439 202 414 C209 461 164 491 107 475 M116 471 Q165 450 193 426 M52 575 C13 563 5 532 9 507 C41 520 55 544 52 575 M49 565 L16 520 M44 630 C84 593 117 610 141 589 C140 636 96 654 44 630 M53 629 Q100 625 130 600"/>
   <path className="floral-stroke" d="M92 402 C131 384 149 349 136 331 C121 312 103 331 115 342 M55 545 C-1 524 -14 478 8 466 C24 456 39 477 24 486"/>
   <path className="floral-stroke floral-filigree" d="M76 235 L48 223 M66 221 L38 207 M54 207 L30 191 M122 289 L137 278 M144 291 L160 281 M56 341 L33 335 M40 326 L21 322 M136 461 L145 439 M155 451 L171 433 M42 551 L24 545 M34 537 L18 532 M76 626 L87 612 M94 621 L111 609"/>
   <path className="floral-stroke floral-tendril" d="M41 658 C83 685 112 674 102 654 C96 642 81 651 90 658 M57 188 C4 154 -3 127 13 114 M87 385 Q44 414 40 445 M59 611 Q18 628 16 651"/>
   <Bud x={43} y={422} rotation={-28}/><Bud x={21} y={631} rotation={-36}/>
   <SeedSprig x={38} y={305} rotation={-24}/>
   <path className="floral-stroke floral-engraving" d="M74 230 Q62 219 54 217 M67 214 Q57 204 45 201 M56 200 Q44 190 35 188 M40 549 Q31 540 25 538 M73 630 Q90 633 101 627 M87 621 Q99 621 110 615"/>
   <Flower x={65} y={113} size={1.32}/><Flower x={99} y={473} size={.72} petals={16}/>
  </g>
  </svg><svg className="floral-frame floral-frame-right" viewBox="1000 0 280 830" preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
  <g className="floral-spray floral-spray-right">
   <path className="floral-stroke floral-stem" d="M1230 85 C1100 151 1205 270 1131 349 C1069 415 1191 516 1120 618 C1095 654 1107 703 1160 794"/>
   <path className="floral-stroke" d="M1149 216 C1095 206 1088 166 1058 147 C1066 199 1100 230 1149 216 M1139 212 Q1092 189 1068 157 M1137 337 C1175 315 1196 278 1183 249 C1150 266 1137 300 1137 337 M1142 326 L1178 263 M1118 421 C1076 391 1042 401 1029 374 C1018 423 1069 452 1118 421 M1106 420 Q1061 413 1038 387 M1151 540 C1196 507 1197 477 1211 461 C1223 511 1194 541 1151 540 M1164 533 L1209 476 M1106 653 C1058 635 1032 658 1009 641 C1026 687 1072 685 1106 653 M1095 657 L1023 650"/>
   <path className="floral-stroke" d="M1139 287 C1096 264 1088 229 1067 239 C1048 248 1065 267 1074 257 M1140 568 C1177 560 1201 584 1189 601 C1180 613 1162 602 1171 593"/>
   <path className="floral-stroke floral-filigree" d="M1123 204 L1105 183 M1103 190 L1088 173 M1148 313 L1165 299 M1159 290 L1175 279 M1089 414 L1078 398 M1068 406 L1052 392 M1175 518 L1196 504 M1188 499 L1205 486 M1081 657 L1063 668 M1055 654 L1039 664"/>
   <path className="floral-stroke floral-tendril" d="M1141 374 Q1186 370 1187 413 M1122 706 C1073 695 1060 735 1081 739 C1095 741 1096 723 1085 726 M1141 471 Q1180 441 1191 457"/>
   <Bud x={1183} y={391} rotation={24}/><Bud x={1184} y={462} rotation={48}/>
   <SeedSprig x={1171} y={750} rotation={32}/>
   <path className="floral-stroke floral-engraving" d="M1124 210 Q1104 206 1094 196 M1111 201 Q1094 193 1087 184 M1148 309 Q1154 289 1163 278 M1157 291 Q1162 278 1170 271 M1178 519 Q1196 513 1201 503 M1069 657 Q1055 664 1045 660"/>
   <Flower x={1123} y={616} size={1.55} petals={16}/><Flower x={1147} y={181} size={.7}/>
  </g>
 </svg></div>;
}
