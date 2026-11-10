import type {z} from 'zod';
import type {Query} from '../../core/db.js';
import type {Context} from '../foundation/service.js';
import {siteSchemas as s,type SiteOperationId} from './contracts.js';

const fieldsOf=(b:z.infer<typeof s.create>)=>JSON.stringify({kind:b.kind,title:b.title,summary:b.summary,body:b.body,event_on:b.event_on,event_ends_on:b.event_ends_on,
  event_time:b.event_time,venue:b.venue,pinned:b.pinned});
const one=async(tx:Query,sql:string,params:unknown[])=>{const [row]=await tx.query<{r:unknown}>(sql,params);return row!.r;};

export async function executeSite(id:SiteOperationId,ctx:Context,input:{body:unknown;query:unknown;id?:string}){
  const {tx}=ctx;
  switch(id){
    case 'announcementList':return one(tx,'select edunexus.read_announcements($1) r',[(input.query as z.infer<typeof s.list>).archived==='true']);
    case 'announcementCreate':{const b=input.body as z.infer<typeof s.create>;return one(tx,'select edunexus.save_announcement(null,0,$1::jsonb,$2) r',[fieldsOf(b),b.reason]);}
    case 'announcementUpdate':{const b=input.body as z.infer<typeof s.update>;return one(tx,'select edunexus.save_announcement($1,$2,$3::jsonb,$4) r',[input.id,b.version,fieldsOf(b),b.reason]);}
    case 'announcementStatus':{const b=input.body as z.infer<typeof s.status>;return one(tx,'select edunexus.set_announcement_status($1,$2,$3,$4) r',[input.id,b.version,b.action,b.reason]);}
    case 'siteFaqList':return one(tx,'select edunexus.read_site_faqs($1) r',[(input.query as z.infer<typeof s.list>).archived==='true']);
    case 'siteFaqCreate':{const b=input.body as z.infer<typeof s.faqCreate>;return one(tx,'select edunexus.save_site_faq(null,0,$1::jsonb,$2) r',[JSON.stringify({question:b.question,answer:b.answer,position:b.position}),b.reason]);}
    case 'siteFaqUpdate':{const b=input.body as z.infer<typeof s.faqUpdate>;return one(tx,'select edunexus.save_site_faq($1,$2,$3::jsonb,$4) r',[input.id,b.version,JSON.stringify({question:b.question,answer:b.answer,position:b.position}),b.reason]);}
    case 'siteFaqStatus':{const b=input.body as z.infer<typeof s.status>;return one(tx,'select edunexus.set_site_faq_status($1,$2,$3,$4) r',[input.id,b.version,b.action,b.reason]);}
    case 'siteSettingsSave':{
      const {version,reason,...f}=input.body as z.infer<typeof s.settings>;
      return one(tx,'select edunexus.save_site_settings($1,$2::jsonb,$3) r',[version,JSON.stringify(f),reason]);
    }
  }
}

/** The front page's one read, made without signing in. Only what the school published comes back. */
export async function readPublicSite(tx:Query){return one(tx,'select edunexus.read_public_site() r',[]);}
