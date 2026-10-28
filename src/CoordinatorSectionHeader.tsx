import type {ReactNode} from 'react';

export default function CoordinatorSectionHeader({title,description,actions}:{title:string;description:string;actions?:ReactNode}){
 return <header className="coordinator-section-heading"><div><h2>{title}</h2><p>{description}</p></div>{actions&&<div className="coordinator-section-actions">{actions}</div>}</header>;
}
