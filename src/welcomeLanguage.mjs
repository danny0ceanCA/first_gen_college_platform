/** Translate presentation only: the stored stage remains a canonical schema value. */
export function welcomeStageLabel(stage,language){
 if(language!=='es')return stage;
 return ({'9th grade':'9.º grado','10th grade':'10.º grado','11th grade':'11.º grado','12th grade':'12.º grado','Community college':'Colegio comunitario','College':'Universidad'})[stage]||stage;
}
