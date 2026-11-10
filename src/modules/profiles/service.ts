import type {z} from 'zod';
import type {Query} from '../../core/db.js';
import {AppError} from '../../core/errors.js';
import type {Context} from '../foundation/service.js';
import {checkJpeg} from './jpeg.js';
import {photoLimits,profileSchemas as s,type ProfileOperationId} from './contracts.js';

const one=async(tx:Query,sql:string,params:unknown[])=>{const [row]=await tx.query<{r:unknown}>(sql,params);return row!.r;};
const refused=(path:string,message:string)=>new AppError(422,'PHOTO_INVALID',message,[{path,message}]);

/** Decodes and checks one of the two sizes, answering beside the field that was wrong. */
function picture(encoded:string,path:'image'|'thumb'){
  const limit=photoLimits[path],raw=Buffer.from(encoded,'base64');
  if(raw.length>limit.bytes)throw refused(path,'The picture is too large. Choose it again and it will be made smaller.');
  const checked=checkJpeg(raw,{min:limit.min,max:limit.max,square:true});
  if(!checked)throw refused(path,'This is not a picture EDUNEXUS can keep. Choose a JPEG or PNG photo and try again.');
  return checked;
}

export async function executeProfile(id:ProfileOperationId,ctx:Context,input:{body:unknown;query:unknown;id?:string}){
  const {tx}=ctx;
  switch(id){
    case 'profileGet':return one(tx,'select edunexus.read_my_profile() r',[]);
    case 'profileSave':{const {version,...fields}=input.body as z.infer<typeof s.save>;return one(tx,'select edunexus.save_my_profile($1,$2::jsonb) r',[version,JSON.stringify(fields)]);}
    case 'photoSave':{
      const b=input.body as z.infer<typeof s.photo>;
      const image=picture(b.image,'image'),thumb=picture(b.thumb,'thumb');
      return one(tx,'select edunexus.set_my_photo($1,$2,$3,$4,$5,$6) r',[b.version,image.bytes,thumb.bytes,image.sha256,image.width,image.height]);
    }
    case 'photoRemove':return one(tx,'select edunexus.remove_staff_photo($1,$2,null) r',[ctx.staff.user_id,(input.body as z.infer<typeof s.remove>).version]);
    case 'sessionList':return one(tx,'select edunexus.read_my_sessions($1) r',[ctx.identity.sessionId??null]);
    case 'sessionsEndOthers':return one(tx,'select edunexus.end_my_other_sessions($1) r',[ctx.identity.sessionId??null]);
    case 'nameRequestCreate':{const b=input.body as z.infer<typeof s.nameRequest>;return one(tx,'select edunexus.request_name_change($1,$2,$3) r',[b.display_name,b.position,b.note]);}
    case 'nameRequestWithdraw':return one(tx,'select edunexus.withdraw_name_request($1,$2) r',[input.id,(input.body as z.infer<typeof s.withdraw>).version]);
    case 'nameRequestList':return one(tx,'select edunexus.read_name_requests($1) r',[(input.query as z.infer<typeof s.requests>).status]);
    case 'nameRequestDecide':{const b=input.body as z.infer<typeof s.decide>;return one(tx,'select edunexus.decide_name_request($1,$2,$3,$4) r',[input.id,b.version,b.decision,b.reason]);}
    case 'activityList':{const q=input.query as z.infer<typeof s.activity>;return one(tx,'select edunexus.read_my_activity($1,$2,$3) r',[q.kind,q.before_id??null,q.limit]);}
    case 'staffPhotoGet':return one(tx,'select edunexus.read_staff_photo($1) r',[input.id]);
    case 'staffPhotoRemove':{const b=input.body as z.infer<typeof s.takeDown>;return one(tx,'select edunexus.remove_staff_photo($1,$2,$3) r',[input.id,b.version,b.reason]);}
  }
}
