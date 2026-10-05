import {useState} from 'react';
import {Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import type {Account,Student} from './family';

export default function Welcome({account,es,save,logout,onFinished}:{account:Account;es:boolean;save:(account:Account,student?:Student)=>Promise<boolean>;logout:()=>void;onFinished?:()=>void}){
 const t=(en:string,spanish:string)=>es?spanish:en;
 const [name,setName]=useState(account.firstName);
 const [role,setRole]=useState<Account['role']>(account.role);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState(false);
 const submit=async()=>{
  if(saving||!name.trim()||!role)return;
  setSaving(true);setError(false);
  try{if(!await save({...account,firstName:name.trim(),role}))setError(true);else onFinished?.();}
  catch{setError(true);}finally{setSaving(false);}
 };
 return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
  <Text style={styles.logo}>○ origen.</Text>
  <Text accessibilityRole="header" style={styles.title}>{t('Welcome to Origen','Bienvenido a Origen')}</Text>
  <Text style={styles.body}>{t('We help you understand college, how to pay for it, and your next steps. First, tell us a little about you.','Te ayudamos a entender la universidad, cómo pagarla y tus próximos pasos. Primero, cuéntanos un poco sobre ti.')}</Text>
  <Text style={styles.label}>{t('Your first name','Tu nombre')}</Text>
  <TextInput accessibilityLabel={t('Your first name','Tu nombre')} autoComplete="given-name" maxLength={100} editable={!saving} value={name} onChangeText={setName} style={styles.input}/>
  <Text style={styles.label}>{t('Are you a student or a parent?','¿Eres estudiante o madre/padre?')}</Text>
  <View accessibilityRole="radiogroup" style={styles.choices}>{(['student','parent'] as const).map(value=><Pressable key={value} accessibilityRole="radio" accessibilityState={{checked:role===value,disabled:saving}} disabled={saving} onPress={()=>setRole(value)} style={[styles.choice,role===value&&styles.selected]}><Text style={styles.choiceText}>{value==='student'?t('I am a student','Soy estudiante'):t('I am a parent or guardian','Soy madre, padre o tutor')}</Text></Pressable>)}</View>
  {role&&<Text style={styles.body}>{role==='student'?t('You can add your own school, interests and goals.','Puedes agregar tu escuela, intereses y metas.'):t('You can add each student you support, one at a time.','Puedes agregar a cada estudiante que apoyas, uno a la vez.')}</Text>}
  <Pressable accessibilityRole="button" accessibilityState={{disabled:saving||!name.trim()||!role}} disabled={saving||!name.trim()||!role} onPress={()=>void submit()} style={[styles.button,(saving||!name.trim()||!role)&&styles.disabled]}><Text style={styles.buttonText}>{saving?t('Saving…','Guardando…'):t('Continue','Continuar')}</Text></Pressable>
  {error&&<Text accessibilityRole="alert" style={styles.error}>{t('Could not save. Your answers are still here. Please try again.','No se pudo guardar. Tus respuestas siguen aquí. Intenta de nuevo.')}</Text>}
  <Pressable accessibilityRole="button" disabled={saving} onPress={logout} style={styles.exit}><Text style={styles.choiceText}>{t('Log out','Cerrar sesión')}</Text></Pressable>
 </ScrollView></SafeAreaView>;
}
const styles=StyleSheet.create({page:{flex:1,backgroundColor:'#faf9f4'},content:{padding:24,paddingBottom:40},logo:{color:'#254e42',fontSize:27,fontWeight:'700',marginBottom:30},title:{fontSize:30,fontWeight:'600',color:'#254e42',marginBottom:14},body:{fontSize:16,lineHeight:25,color:'#52675a',marginVertical:12},label:{fontSize:16,color:'#254e42',fontWeight:'600',marginTop:20,marginBottom:10},input:{borderWidth:1,borderColor:'#dce3d6',borderRadius:12,padding:14,fontSize:17,color:'#254e42',backgroundColor:'white'},choices:{gap:10},choice:{minHeight:56,padding:16,borderRadius:14,borderWidth:1,borderColor:'#dce3d6',backgroundColor:'white'},selected:{backgroundColor:'#eaf0e4',borderColor:'#254e42'},choiceText:{fontSize:16,color:'#254e42'},button:{minHeight:52,marginTop:24,padding:16,borderRadius:12,backgroundColor:'#254e42',alignItems:'center'},buttonText:{color:'#eadcc4',fontSize:16,fontWeight:'700'},disabled:{opacity:0.5},error:{color:'#a44836',marginTop:16,fontSize:15,lineHeight:23},exit:{minHeight:48,justifyContent:'center',alignItems:'center',marginTop:16}});
