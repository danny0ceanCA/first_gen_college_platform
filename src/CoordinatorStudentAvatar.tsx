import './CoordinatorStudentAvatar.css';
/** A quiet visual anchor carried from the student card onto their shared paper. */
export default function CoordinatorStudentAvatar({name}:{name:string}){
 const words=name.trim().split(/\s+/).filter(Boolean);
 const initials=[words[0],words.length>1?words[words.length-1]:undefined].filter(Boolean).map(word=>Array.from(word!)[0]).join('').toLocaleUpperCase();
 return <span className="coordinator-student-avatar" aria-hidden="true">{initials}</span>;
}
