import {
  CONFIG,INSURANCES,createEnvelope,cardDisplay,positionOnPath,moveEntity,mergeEntities,buyOffer,
  refreshOffers,salvage,startWave,tick,purchaseItem,startNextRun,nextActionId,actionAlreadyProcessed,
  receiptFor,recordAction,commitEnvelope,loadProfile,migrateFrom06,migrateFrom07,migrateFrom08,pauseRecoveredCombat,ratingLabel,buyCostForWave
} from "./core.js?v=0.9.0";

window.__liLePeiBooted = true;

const $=id=>document.getElementById(id),clone=value=>JSON.parse(JSON.stringify(value));
const STORE_KEY=CONFIG.persistence.authoritative_key,LOCK_NAME=STORE_KEY+":writer";
const ITEM_CATALOG=[
  {id:"zero_settlement",name:"零结",price:CONFIG.shop.zero_settlement_price,effect:"清除当前在场的来件，每只获得1保费。",icon:"item-zero-settlement.svg"},
  {id:"deny_claim",name:"拒赔",price:CONFIG.shop.deny_claim_price,effect:"将当前来件退回入口，保留身份和生命。",icon:"item-reject.svg"},
  {id:"outside_liability",name:"不属责",price:CONFIG.shop.outside_liability_price,effect:"3秒内漏过防线不扣查勘员耐久。",icon:"item-not-liable.svg"}
];
const $game=()=>envelope?.game,$profile=()=>envelope?.profile,$run=()=>envelope?.run;
const PHASE_LABEL={prep:"布防",combat:"战斗中",paused:"已暂停",victory:"结案",defeat:"查勘员失守"};
const phaseText=phase=>PHASE_LABEL[phase]||phase;
const TILE={path:"./assets/0.7/tile-path.svg",office:"./assets/0.7/tile-office.svg",ground:"./assets/0.7/tile-ground.svg",arrow:"./assets/0.7/path-arrow.svg",entry:"./assets/0.7/marker-entry.svg",exit:"./assets/0.7/marker-exit.svg",inspector:"./assets/0.7/inspector.svg"};
const UNIT_ICON={car_damage:"./assets/0.7/unit-car-damage.svg",construction:"./assets/0.7/unit-construction.svg",property:"./assets/0.7/unit-property.svg",machine_damage:"./assets/0.9/unit-machine-damage.svg",liability:"./assets/0.9/unit-liability.svg",marine:"./assets/0.9/unit-marine.svg"};
const ENEMY_TOKEN={third_party_car:"./assets/0.9/enemy-token-thief.svg",foreman:"./assets/0.9/enemy-token-soldier.svg"};
const ENEMY_CHAR={third_party_car:"贼",foreman:"兵"};
const ENEMY_ICON={third_party_car:"./assets/0.7/enemy-third-party-car.svg",foreman:"./assets/0.7/enemy-foreman.svg"};
const ITEM_ICON=Object.fromEntries(ITEM_CATALOG.map(item=>[item.id,"./assets/0.7/"+item.icon]));
let envelope=null,mode="booting",screen="cover",message="",showResumeNotice=false,mergeMode=false;
let shopReturn="cover",modalIntent=null,modalBusy=false,saveBlocked=null,toastTimer=null;
let lockRelease=null,lastFrame=performance.now(),accumulator=0,pointerDrag=null,dragRaf=0,suppressPostDragClick=false,dropTargetNode=null;
let storageMetrics={lastMs:0,maxMs:0,longFrames:0,ticks:0,writes:0,serializedBytes:0};let lastActionSignature="",lastActionTime=0;
let boardDirty=true,boardSig="",terminalDismissed=false,lastHandSig="",lastOfferSig="",lastPhaseKey="";
let lastHeartSig="",lastLogSig="",lastItemSig="";
let observedWave=0,lastLeakCount=0,waveBannerTimer=null,leakTimer=null;
const $say=message=>{const toast=$("toast");if(!toast)return;toast.textContent=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.textContent="";},3500);};
const isPrep=()=>Boolean($game()?.phase==="prep"),isPersistent=()=>mode==="writer",canMutate=()=>!saveBlocked&&(mode==="writer"||mode==="memory");
function blankTemporaryEnvelope(){return createEnvelope(CONFIG.simulation.default_seed,{premium:0,grantApplied:true});}
function enterMemory(reason){mode="memory";envelope=blankTemporaryEnvelope();screen="cover";message=reason||"当前为临时试玩：0保费、免费条款、不保存，无法购买道具。";if(lockRelease){lockRelease();lockRelease=null;}observedWave=$game().current_wave;startRendering();}
function enterReadOnly(reason){mode="readonly";screen="readonly";message=reason||"案卷已在其他窗口打开，请回到原窗口继续。";try{const loaded=loadProfile(window.localStorage);if(loaded.kind==="native")envelope=loaded.envelope;else envelope=null;}catch{envelope=null;}startRendering();}
function startRendering(){lastFrame=performance.now();accumulator=0;render();requestAnimationFrame(frame);}

function initializeWriter(){
  let loaded;try{loaded=loadProfile(window.localStorage);}catch{enterMemory("本地保存不可用。临时试玩不保存，余额和道具库存为0。");return;}
  if(loaded.kind==="native"){
    if(loaded.envelope.game.phase==="combat"){
      const recovered=pauseRecoveredCombat(loaded.envelope);if(!recovered.ok){enterReadOnly(recovered.reason);return;}
      const paused=commitEnvelope(loaded.envelope,recovered.envelope,window.localStorage);
      if(!paused.ok){enterReadOnly("战斗已暂停在上次保存点，但暂停状态暂未写回。请重新打开原窗口重试。");return;}
      envelope=paused.envelope;showResumeNotice=true;
    }else envelope=loaded.envelope;
    mode="writer";screen="cover";observedWave=$game().current_wave;return;
  }
  if(loaded.kind==="import08"||loaded.kind==="import07"||loaded.kind==="import06"){
    const sourceKey=loaded.source?.key||loaded.envelope.format_id;
    const migrate=loaded.kind==="import08"?migrateFrom08:loaded.kind==="import07"?migrateFrom07:migrateFrom06;
    const migrated=migrate(loaded.envelope,{key:sourceKey,raw:loaded.raw});
    if(!migrated.ok){enterMemory(migrated.reason+" 可选择临时试玩，本次不会保存。");return;}
    const saved=commitEnvelope(null,migrated.envelope,window.localStorage);
    if(saved.ok){envelope=saved.envelope;mode="writer";screen="cover";message="旧案卷已接续：保费、库存与当前局面保留；返利从 0 起，旧档原样保留。";showResumeNotice=true;observedWave=$game().current_wave;return;}
    enterMemory("旧案未能安全迁入，原存档已保留。可临时试玩，但本次不会保存。");return;
  }
  if(loaded.kind==="corrupt_import08"||loaded.kind==="corrupt_import07"||loaded.kind==="corrupt_import06"){enterMemory(loaded.reason+" 原案卷不会被覆盖。");return;}
  if(loaded.kind==="empty"){
    const fresh=createEnvelope(CONFIG.simulation.default_seed,{premium:CONFIG.profile.first_grant,grantApplied:true});
    const saved=commitEnvelope(null,fresh,window.localStorage);
    if(saved.ok){envelope=saved.envelope;mode="writer";screen="cover";observedWave=1;return;}
    enterMemory("新案卷未能保存，因此没有发放可持久保费。可选择0保费临时试玩。");return;
  }
  enterMemory((loaded.reason||"案件存储不可用。")+" 原案卷不会被覆盖；临时试玩不保存、不能购买道具。");
}

function boot(){
  if(!navigator.locks?.request){enterMemory("此浏览器不支持安全的独占存档。可临时试玩：0保费、不保存、不能购买道具。");return;}
  let readyResolve;const ready=new Promise(resolve=>{readyResolve=resolve;});
  navigator.locks.request(LOCK_NAME,{mode:"exclusive",ifAvailable:true},async lock=>{
    if(!lock){enterReadOnly("案卷已在其他窗口打开。本窗口为只读状态，不能布阵、推进战斗或修改存档。");readyResolve();return;}
    const hold=new Promise(resolve=>{lockRelease=resolve;});
    try{initializeWriter();if(mode==="memory"||mode==="readonly"){readyResolve();return;}startRendering();readyResolve();await hold;}
    catch(error){enterMemory("无法安全打开案件："+(error?.message||"未知错误")+"。当前仅能临时试玩。");readyResolve();}
  }).catch(error=>{enterMemory("无法取得安全存档锁："+(error?.message||"未知错误")+"。当前仅能临时试玩。");readyResolve();});
  ready.then(()=>{});
}

function preflight(intent,type,details){
  const prior=receiptFor(envelope,intent.actionId);
  if(prior){const same=prior.type===type&&JSON.stringify(prior.details)===JSON.stringify(details);$say(same?"这个操作已经保存。":"此操作编号已用于其他操作；未重复执行。");return false;}
  if(actionAlreadyProcessed(envelope,intent.actionId)){$say("操作已过期，请重新打开确认。");return false;}
  if(envelope.revision!==intent.expectedRevision||$run().run_id!==intent.expectedRunId){$say("案件状态已变化，请重新选择后操作。");render();return false;}
  return true;
}
function commitCandidate(previous,candidate){
  if(mode==="memory"){
    candidate.revision=previous.revision+1;envelope=candidate;return{ok:true,envelope:candidate};
  }
  if(mode!=="writer")return{ok:false,reason:"当前窗口不能写入案件。"};
  let beforeRaw;try{beforeRaw=window.localStorage.getItem(STORE_KEY);}catch{beforeRaw=null;}
  const started=performance.now(),result=commitEnvelope(previous,candidate,window.localStorage);storageMetrics.lastMs=performance.now()-started;storageMetrics.maxMs=Math.max(storageMetrics.maxMs,storageMetrics.lastMs);
  if(result.ok){envelope=result.envelope;storageMetrics.writes++;try{storageMetrics.serializedBytes=JSON.stringify(result.envelope).length;}catch{}return result;}
  const expected=clone(candidate);expected.revision=previous.revision+1;let afterRaw=null;try{afterRaw=window.localStorage.getItem(STORE_KEY);}catch{}
  const expectedRaw=JSON.stringify(expected);
  if(afterRaw===expectedRaw){envelope=expected;storageMetrics.writes++;return{ok:true,envelope:expected,reconciled:true};}
  saveBlocked={previous,candidate:expected,previousRaw:beforeRaw,reason:result.reason||"保存结果需要核对。",kind:result.kind};
  return{ok:false,reason:saveBlocked.reason,kind:result.kind};
}
function reconcileSave(){
  if(!saveBlocked||mode!=="writer")return;let raw;try{raw=window.localStorage.getItem(STORE_KEY);}catch{$("saveIssueText").textContent="仍无法读取保存结果，请稍后再试。";return;}
  if(raw===JSON.stringify(saveBlocked.candidate)){
    envelope=saveBlocked.candidate;saveBlocked=null;$say("已确认本次进度保存成功。");render();return;
  }
  if(raw===saveBlocked.previousRaw){envelope=saveBlocked.previous;saveBlocked=null;$say("本次操作未写入，已恢复到上次成功保存的进度。");lastFrame=performance.now();accumulator=0;render();return;}
  const loaded=loadProfile(window.localStorage);
  if(loaded.kind==="native"&&loaded.envelope.profile.profile_id===$profile().profile_id){envelope=loaded.envelope;mode="readonly";screen="readonly";message="检测到另一个保存版本；本窗口已切换为只读，请重新打开案件。";saveBlocked=null;render();return;}
  $("saveIssueText").textContent="仍无法判定哪份记录是最新。游戏已冻结，未自动重试消费或奖励。";
}
function runUserAction(type,details,mutate,successMessage){
  if(!canMutate()){$say(saveBlocked?"保存结果待核对，游戏操作已暂停。":"当前无法修改案件。");return false;}
  const signature=type+":"+JSON.stringify(details),now=performance.now();if(signature===lastActionSignature&&now-lastActionTime<350)return false;lastActionSignature=signature;lastActionTime=now;
  const intent={actionId:nextActionId(envelope),expectedRevision:envelope.revision,expectedRunId:$run().run_id};if(!preflight(intent,type,details))return false;
  const previous=envelope,candidate=clone(envelope);let result;
  try{result=mutate(candidate);}catch(error){$say(error?.message||"操作未完成。");return false;}
  if(result===false||result?.ok===false){$say(result?.reason||"操作未完成，案件未改变。");render();return false;}
  const receipt=recordAction(candidate,intent.actionId,type,details);if(!receipt.ok){$say(receipt.reason);return false;}
  const saved=commitCandidate(previous,candidate);if(!saved.ok){$say(saved.reason+"本次操作未显示成功。");render();return false;}
  if(successMessage)$say(typeof successMessage==="function"?successMessage(result):successMessage);render();return true;
}

function askConfirm(kind,data={}){
  if(!canMutate()){$say("当前不能修改案件。");return;}
  const intent={kind,actionId:nextActionId(envelope),expectedRevision:envelope.revision,expectedRunId:$run().run_id,...data};modalIntent=intent;modalBusy=false;$("confirmAccept").disabled=false;
  const title=$("confirmTitle"),text=$("confirmText"),accept=$("confirmAccept");
  if(kind==="purchase"){
    const item=ITEM_CATALOG.find(entry=>entry.id===data.itemId);title.textContent="确认购买";text.textContent="用返利购买「"+item.name+"」×1，价格 "+item.price+" 返利。购买后返利余额 "+($profile().rebate-item.price)+"，库存 "+($profile().inventory[item.id]+1)+"；保费不受影响。";accept.textContent="确认购买";
  }else if(kind==="item"){
    const item=ITEM_CATALOG.find(entry=>entry.id===data.itemId);title.textContent="确认使用「"+item.name+"」";text.textContent=item.effect+" 确认后立即执行下一个战斗步并扣除1件库存；取消不消耗。";accept.textContent="确认使用";
  }else if(kind==="salvage"){
    const card=cardAtRef(data.ref),info=cardDisplay(card),credit=card.salvage_credit||0,cap=CONFIG.salvage.refund_cap_by_level[card.level-1]||0,refund=Math.min(credit,cap);title.textContent="确认回收条款";text.textContent="回收「"+info.name+"」"+info.level+"级，返还 "+refund+" 保费。"+(refund===0?"这份免费或继承条款不会返还保费。":"回收后无法撤销。");accept.textContent="确认回收";
  }else{
    const defeat=$game().phase==="defeat";
    title.textContent=defeat?"重新挑战":$run().status==="terminal"?"确认开始新局":"确认开始新局";
    text.textContent=$run().status==="terminal"?(defeat?"本局已失守。重新挑战将开始新一局：保费与道具库存保留，本局道具次数重置。":"本局已经结案。将免费开始下一局，保留当前保费与道具库存。"):"放弃当前案件会清除本局布阵和进度，不返还已用道具，也不会发放结案奖励。保费和道具库存保留。";
    accept.textContent=defeat?"重新挑战":"开始新局";
  }
  $("confirmLayer").hidden=false;accumulator=0;lastFrame=performance.now();render();
}
function closeConfirm(){modalIntent=null;modalBusy=false;$("confirmLayer").hidden=true;accumulator=0;lastFrame=performance.now();render();}
function confirmPreflight(intent,type,details){return preflight(intent,type,details);}
function completeModalAction(){
  if(!modalIntent||modalBusy)return;modalBusy=true;const intent=modalIntent,accept=$("confirmAccept");accept.disabled=true;
  let success=false,messageText="";
  if(intent.kind==="purchase"){
    const details={item_id:intent.itemId};if(!confirmPreflight(intent,"purchase-item",details)){closeConfirm();return;}
    const previous=envelope,candidate=clone(envelope),result=purchaseItem(candidate.game,candidate.profile,candidate.run,intent.itemId);
    if(!result.ok){messageText=result.reason;}else{const receipt=recordAction(candidate,intent.actionId,"purchase-item",details);if(!receipt.ok)messageText=receipt.reason;else{const saved=commitCandidate(previous,candidate);success=saved.ok;messageText=success?"已用返利购买"+ITEM_CATALOG.find(item=>item.id===intent.itemId).name+"，保费不变。":saved.reason;}}
  }else if(intent.kind==="item"){
    const details={item_id:intent.itemId};if(!confirmPreflight(intent,"use-item",details)){closeConfirm();return;}
    const previous=envelope,candidate=clone(envelope),result=tick(candidate.game,candidate.profile,candidate.run,intent.itemId);
    if(!result.ok){
      const fresh=clone(previous),normal=tick(fresh.game,fresh.profile,fresh.run);if(normal?.ok){const saved=commitCandidate(previous,fresh);if(!saved.ok)messageText=saved.reason;else messageText=result.reason+"未消耗道具；战斗已正常推进。";}else messageText=result.reason+"未消耗道具。";
    }else{
      const receipt=recordAction(candidate,intent.actionId,"use-item",details);if(!receipt.ok)messageText=receipt.reason;else{const saved=commitCandidate(previous,candidate);success=saved.ok;messageText=success?"已使用"+ITEM_CATALOG.find(item=>item.id===intent.itemId).name+"。":saved.reason;}
    }
  }else if(intent.kind==="salvage"){
    const details={ref:intent.ref};if(!confirmPreflight(intent,"salvage",details)){closeConfirm();return;}
    const previous=envelope,candidate=clone(envelope),result=salvage(candidate.game,candidate.profile,intent.ref,true);
    if(!result.ok)messageText=result.reason;else{const receipt=recordAction(candidate,intent.actionId,"salvage",details);if(!receipt.ok)messageText=receipt.reason;else{const saved=commitCandidate(previous,candidate);success=saved.ok;messageText=success?"已回收，返还"+result.refund+"保费。":saved.reason;}}
  }else{
    const details={from_run:intent.expectedRunId,to_run:$profile().profile_id+":run:"+($run().run_seq+1),seed:$game().initial_seed};if(!confirmPreflight(intent,"new-run",details)){closeConfirm();return;}
    const previous=envelope,result=startNextRun(envelope,$game().initial_seed,intent.actionId);
    if(!result.ok)messageText=result.reason;else{const saved=commitCandidate(previous,result.envelope);success=saved.ok;messageText=success?"新局已开始，保费与库存已保留。":saved.reason;if(success){terminalDismissed=false;lastHandSig="";lastOfferSig="";boardDirty=true;observedWave=1;lastLeakCount=0;}}
  }
  closeConfirm();if(messageText)$say(messageText);if(success){lastFrame=performance.now();accumulator=0;}render();
}

function isSameRef(a,b){return a&&b&&a.area===b.area&&a.index===b.index;}
function cardAtRef(ref){if(!ref)return null;const g=$game();return(ref.area==="hand"?g.hand:ref.area==="offer"?g.offers:ref.area==="formation"?g.formation:[])[ref.index]||null;}
function mergeCompatible(a,b){return a&&b&&a.type===b.type&&a.level===b.level&&a.equipment_id===b.equipment_id&&a.level<CONFIG.economy.max_level;}
function remainingEnemies(g){const wave=CONFIG.waves.find(item=>item.id===g.current_wave);const alive=g.enemies.filter(enemy=>enemy.hp>0).length;return Math.max(0,wave.spawns.length-g.spawns_done)+alive;}
function dragTargetAt(x,y){const element=document.elementFromPoint(x,y);return element?.closest("[data-drop-area]")||null;}
function canDrop(source,target){if(!isPrep()||!canMutate()||!cardAtRef(source)||!target)return false;const area=target.dataset.dropArea,index=Number(target.dataset.dropIndex),g=$game();if(!Number.isInteger(index))return false;
  if(area==="formation"){
    const tower=g.formation[index];
    if(source.area==="offer")return false; // 0.8: offers only go to the hand, never straight to an office
    if(source.area==="hand")return tower?mergeCompatible(cardAtRef(source),tower):true;
    if(source.area==="formation")return source.index!==index&&!tower;
    return false;
  }
  if(area==="hand"){
    if(source.area==="offer")return g.hand[index]===null&&$profile().premium>=buyCostForWave(g.current_wave);
    if(source.area==="formation")return g.hand[index]===null;
    return source.area==="hand"&&source.index!==index&&mergeCompatible(cardAtRef(source),g.hand[index]);
  }
  return false;
}
function updateDropTarget(){const candidate=pointerDrag?.active?dragTargetAt(pointerDrag.x,pointerDrag.y):null,next=candidate&&canDrop(pointerDrag.ref,candidate)?candidate:null;if(next===dropTargetNode)return;dropTargetNode?.classList.remove("drop-target");dropTargetNode=next;if(dropTargetNode)dropTargetNode.classList.add("drop-target");}
function performDrop(source,target){if(!isPrep()){ $say("布防阶段才能拖动条款。");return;}if(!target){$say("已取消拖动，条款和保费未改变。");return;}const targetRef={area:target.dataset.dropArea,index:Number(target.dataset.dropIndex)};if(!canDrop(source,target)){$say("目标不兼容或已占用，条款和保费未改变。");return;}
  const sourceCard=cardAtRef(source),targetCard=cardAtRef(targetRef),name=cardDisplay(sourceCard).name;
  if(source.area==="offer"&&targetRef.area==="hand")buyOfferAction(source.index);
  else if(source.area==="formation"&&targetRef.area==="hand")moveBackAction(source,targetRef.index);
  else if(targetCard||targetRef.area==="hand")runUserAction("merge",{source,target:targetRef},draft=>mergeEntities(draft.game,source,targetRef),"拖动合成完成。");
  else runUserAction("move",{source,target:targetRef},draft=>moveEntity(draft.game,source,targetRef),"已将"+name+"布置到办公位"+(targetRef.index+1)+"。");
  mergeMode=false;render();
}
function stopPointerDrag(cancelled=false){if(!pointerDrag)return;const drag=pointerDrag;pointerDrag=null;cancelAnimationFrame(dragRaf);dragRaf=0;dropTargetNode?.classList.remove("drop-target");dropTargetNode=null;drag.sourceNode?.classList.remove("drag-source");drag.ghost?.remove();document.body.classList.remove("is-dragging");if(drag.active&&!cancelled){suppressPostDragClick=true;setTimeout(()=>{suppressPostDragClick=false;},0);performDrop(drag.ref,dragTargetAt(drag.x,drag.y));}}
function dragAutoScroll(){if(!pointerDrag?.active)return;const edge=58;if(pointerDrag.y<edge&&pointerDrag.scrollDirection<0&&window.scrollY>0)window.scrollBy(0,-8);else if(pointerDrag.y>window.innerHeight-edge&&pointerDrag.scrollDirection>0)window.scrollBy(0,8);updateDropTarget();dragRaf=requestAnimationFrame(dragAutoScroll);}
document.addEventListener("pointerdown",event=>{if(event.button!==0||!isPrep()||!canMutate())return;const card=event.target.closest?.("[data-drop-area]");if(!card||card.dataset.dropArea==="formation"&&card.closest("#boardGrid")==null)return;const ref={area:card.dataset.dropArea,index:Number(card.dataset.dropIndex)};if(!cardAtRef(ref))return;pointerDrag={ref,card,sourceNode:card,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,active:false};},{passive:true});
document.addEventListener("pointermove",event=>{if(!pointerDrag||event.pointerId!==pointerDrag.pointerId)return;const deltaY=event.clientY-pointerDrag.y;if(deltaY)pointerDrag.scrollDirection=Math.sign(deltaY);pointerDrag.x=event.clientX;pointerDrag.y=event.clientY;if(!pointerDrag.active&&Math.hypot(event.clientX-pointerDrag.startX,event.clientY-pointerDrag.startY)>8){pointerDrag.active=true;pointerDrag.sourceNode.classList.add("drag-source");document.body.classList.add("is-dragging");const ghost=pointerDrag.sourceNode.cloneNode(true);ghost.classList.add("drag-ghost");document.body.append(ghost);pointerDrag.ghost=ghost;dragRaf=requestAnimationFrame(dragAutoScroll);}if(pointerDrag.active){event.preventDefault();pointerDrag.ghost.style.left=(event.clientX+12)+"px";pointerDrag.ghost.style.top=(event.clientY+12)+"px";updateDropTarget();}},{passive:false});
document.addEventListener("pointerup",event=>{if(pointerDrag&&event.pointerId===pointerDrag.pointerId){pointerDrag.x=event.clientX;pointerDrag.y=event.clientY;stopPointerDrag(false);}},{passive:true});
document.addEventListener("pointercancel",event=>{if(pointerDrag&&event.pointerId===pointerDrag.pointerId)stopPointerDrag(true);},{passive:true});window.addEventListener("blur",()=>stopPointerDrag(true));document.addEventListener("visibilitychange",()=>{if(document.hidden)stopPointerDrag(true);});
document.addEventListener("click",event=>{if(suppressPostDragClick){suppressPostDragClick=false;event.preventDefault();event.stopImmediatePropagation();}},true);

function describe(card){if(!card){$("detailTitle").textContent="未选择条款";$("detailText").textContent="点选待启用条款或办公位查看等级、装备与攻击范围。";$("detailsDisclosure").querySelector("summary").textContent="查看选中条款说明";return;}const info=cardDisplay(card),spec=CONFIG.towers.find(item=>item.id===card.type);$("detailTitle").textContent=info.name+" · "+info.level+"级";$("detailText").textContent=info.attack+" 攻击范围约"+spec.radius_cells+"格。装备："+info.equipment+"。";$("detailsDisclosure").querySelector("summary").textContent="已选条款 · "+info.name;}
function clearSelection(messageText=""){if($game())$game().selected=null;mergeMode=false;describe(null);if(messageText)$say(messageText);render();}
function selectEntity(ref,card){const g=$game();if(!isPrep()){$say("战斗中不能调整条款。");return;}if(!canMutate())return;
  if(mergeMode&&g.selected?.area==="hand"&&!isSameRef(g.selected,ref)&&ref.area!=="offer"){
    const source=g.selected,target=ref,level=(cardAtRef(target)?.level||0)+1;
    runUserAction("merge",{source,target},draft=>mergeEntities(draft.game,source,target),"合成完成，升级为"+level+"级条款。");mergeMode=false;describe(null);render();return;
  }
  if(mergeMode&&isSameRef(g.selected,ref)){$say("已选来源条款；请选合成目标，或取消合成。");return;}
  if(isSameRef(g.selected,ref)){g.selected=null;mergeMode=false;describe(null);$say("已取消条款选择。");render();return;}
  g.selected=ref;mergeMode=false;describe(card);$say("已选"+cardDisplay(card).name+"；点亮起的办公位布置。");render();
}
function buyOfferAction(index){
  if(!isPrep()){$say("战斗中不能启用条款。");return;}
  const price=buyCostForWave($game().current_wave);
  runUserAction("buy-offer",{offer_index:index},draft=>buyOffer(draft.game,draft.profile,index),"已收进待启用栏，支出 "+price+" 保费。点条款，再点亮起的办公位。");
}
function moveBackAction(source,handIndex){
  if(!isPrep()){$say("战斗中不能调整条款。");return;}
  const g=$game();
  if(g.hand[handIndex]!==null){$say("目标格已有条款，未移动。");return;}
  if(g.hand.filter(Boolean).length>=CONFIG.economy.hand_capacity){$say("待启用栏已满 8/8：先布置或合成一份条款，再收回。");return;}
  const card=cardAtRef(source);if(!card){$say("来源条款已不存在。");return;}
  runUserAction("move-back",{source,target:{area:"hand",index:handIndex}},draft=>moveEntity(draft.game,source,{area:"hand",index:handIndex}),"已将「"+cardDisplay(card).name+"」收回待启用栏（费用 0）。");
}
function startMergeMode(){if(!isPrep()||$game().selected?.area!=="hand"){$say("先选一份待启用条款，再点合成。");return;}mergeMode=true;$say("合成模式：再点一份同类同级条款；也可点兼容办公位合成。");render();}
function officeIndexAt(col,row){return CONFIG.board.office_positions.findIndex(pos=>pos[0]===col&&pos[1]===row);}
function cellKey(col,row){return col+","+row;}
function showRadius(officeIndex){const g=$game();if(g.selected?.area!=="formation"||g.selected.index!==officeIndex)return null;const tower=g.formation[officeIndex],spec=CONFIG.towers.find(item=>item.id===tower?.type);if(!spec)return null;const [col,row]=CONFIG.board.office_positions[officeIndex],radius=spec.radius_cells,range=document.createElement("span");range.className="range-indicator";range.style.width=(radius*2/CONFIG.board.columns*100)+"%";range.style.height=(radius*2/CONFIG.board.rows*100)+"%";range.style.left=((col+.5)/CONFIG.board.columns*100)+"%";range.style.top=((row+.5)/CONFIG.board.rows*100)+"%";range.title="攻击范围约"+radius+"格";return range;}
function placeSelected(officeIndex){const g=$game();if(!g.selected){const tower=g.formation[officeIndex];if(tower){g.selected={area:"formation",index:officeIndex};describe(tower);$say("已选办公位"+(officeIndex+1)+"；红圈显示攻击范围，可选择空位移动。");render();}else $say("先选一份条款，再点办公位。");return;}if(!isPrep()){$say("战斗中不能布置条款。");return;}if(!canMutate())return;
  const selected=g.selected,slot=g.formation[officeIndex];if(selected.area==="formation"&&selected.index===officeIndex){g.selected=null;mergeMode=false;describe(null);$say("已取消办公位选择。");render();return;}
  if(mergeMode&&selected.area==="hand"){if(!slot){$say("合成目标必须已有同类同级条款；退出合成后可布置。");return;}const source=selected,target={area:"formation",index:officeIndex};runUserAction("merge",{source,target},draft=>mergeEntities(draft.game,source,target),"合成完成，办公位已升级。");mergeMode=false;describe(null);render();return;}
  if(slot){$say("办公位已占用；普通点击不会合成，请显式选择合成。");return;}
  const name=cardDisplay(cardAtRef(selected)).name;
  runUserAction("move",{source:selected,target:{area:"formation",index:officeIndex}},draft=>moveEntity(draft.game,selected,{area:"formation",index:officeIndex}),"已将"+name+"布置到办公位"+(officeIndex+1)+"，费用 0。");render();
}
function makeCard(card,ref,area){const button=document.createElement("button"),info=cardDisplay(card);button.type="button";button.className="card "+(area==="offer"?"offer-card":"hand-card")+(isSameRef($game().selected,ref)?" selected":"");button.dataset.dropArea=area;button.dataset.dropIndex=String(ref.index);button.setAttribute("aria-label",(area==="offer"?"可选条款 "+info.name+"，本波选用花费"+buyCostForWave($game().current_wave)+"保费":info.name+" "+info.level+"级"));const glyph=document.createElement("b");glyph.className="card-glyph";glyph.textContent=info.glyph;const name=document.createElement("small");name.className="card-name";name.textContent=info.name;const badge=document.createElement("img");badge.className="card-badge";badge.src=UNIT_ICON[card.type]||"";badge.alt="";button.append(glyph,badge,name);if(area==="hand"){const level=document.createElement("span");level.className="card-level";level.textContent=info.level;button.append(level);}else{const cost=document.createElement("span");cost.className="card-cost";const coin=document.createElement("i");coin.textContent="保";cost.append(coin,document.createTextNode(String(buyCostForWave($game().current_wave))));button.append(cost);}button.addEventListener("click",()=>area==="offer"?buyOfferAction(ref.index):selectEntity(ref,card));return button;}
function makeHandSlot(index){const cell=document.createElement("button");cell.type="button";cell.className="hand-slot";cell.dataset.dropArea="hand";cell.dataset.dropIndex=String(index);cell.textContent="＋";cell.setAttribute("aria-label","待启用条款空格"+(index+1));cell.addEventListener("click",()=>{const g=$game();if(!isPrep()||!canMutate()){$say("战斗中不能调整条款。");return;}const selected=g.selected;if(selected?.area==="formation"){const card=g.formation[selected.index];cell.setAttribute("aria-label","收回"+(card?cardDisplay(card).name:"")+"到待启用栏第"+(index+1)+"格");moveBackAction(selected,index);}else $say("先选一个已布置的办公位，再点空槽收回。");});return cell;}
function arrowAngle(row,col,nextCol,nextRow){if(nextRow===undefined)return 0;if(nextRow>row)return 90;if(nextRow<row)return 270;return nextCol>col?0:180;}
function buildMap(){
  const grid=$("boardGrid"),overlay=$("mapOverlay"),pathIndex=new Map(CONFIG.board.path.map((pos,index)=>[cellKey(...pos),index]));
  if(!grid.dataset.built){
    grid.replaceChildren();
    for(let row=0;row<CONFIG.board.rows;row++)for(let col=0;col<CONFIG.board.columns;col++){
      const index=officeIndexAt(col,row),pathStep=pathIndex.get(cellKey(col,row));let cell;
      if(index>=0){
        cell=document.createElement("button");cell.type="button";cell.className="map-cell office-cell";cell.dataset.office=String(index);cell.dataset.dropArea="formation";cell.dataset.dropIndex=String(index);cell.addEventListener("click",()=>placeSelected(index));
      }else{
        cell=document.createElement("div");cell.className="map-cell";
        if(pathStep!==undefined){
          cell.classList.add("path-cell");
          if(pathStep===0){
            const entry=document.createElement("img");entry.className="entry-icon";entry.src=TILE.entry;entry.alt="";cell.append(entry);
          }else if(pathStep<CONFIG.board.path.length-1){
            const [nextCol,nextRow]=CONFIG.board.path[pathStep+1]||[];
            const arrow=document.createElement("img");arrow.className="path-arrow";arrow.src=TILE.arrow;arrow.alt="";
            arrow.style.transform="rotate("+arrowAngle(row,col,nextCol,nextRow)+"deg)";cell.append(arrow);
          }
        }else cell.classList.add("floor-cell");
      }
      if(col===CONFIG.board.inspector_position[0]&&row===CONFIG.board.inspector_position[1]){
        cell.classList.add("inspector-cell");
        const exit=document.createElement("img");exit.className="exit-mark";exit.src=TILE.exit;exit.alt="";
        const inspector=document.createElement("img");inspector.className="inspector-img";inspector.src=TILE.inspector;inspector.alt="";
        cell.append(exit,inspector);
      }
      grid.append(cell);
    }
    grid.dataset.built="true";
  }
  const sourceCard=cardAtRef($game().selected);
  CONFIG.board.office_positions.forEach(([,],index)=>{
    const cell=grid.querySelector('[data-office="'+index+'"]'),tower=$game().formation[index];if(!cell)return;
    const stunned=Boolean(tower&&tower.stunned_until_ms>$game().elapsed_ms);
    cell.classList.toggle("occupied",Boolean(tower));
    cell.classList.toggle("selected",$game().selected?.area==="formation"&&$game().selected.index===index);
    cell.classList.toggle("place-ready",Boolean($game().selected&&!mergeMode&&!tower));
    cell.classList.toggle("offer-ready",Boolean($game().selected?.area==="offer"&&!tower&&!mergeMode));
    cell.classList.toggle("merge-ready",Boolean(mergeMode&&$game().selected?.area==="hand"&&tower&&sourceCard?.type===tower.type&&sourceCard.level===tower.level&&sourceCard.equipment_id===tower.equipment_id));
    cell.classList.toggle("stunned",stunned);
    cell.disabled=!canMutate();
    cell.replaceChildren();
    if(tower){
      const unit=document.createElement("span");unit.className="unit";
      const glyph=document.createElement("b");glyph.className="unit-glyph";glyph.textContent=INSURANCES[tower.type].glyph;
      const level=document.createElement("small");level.className="unit-level";level.textContent=tower.level;
      unit.append(glyph,level);
      if(stunned){const stun=document.createElement("small");stun.className="unit-stun";stun.textContent="眩";unit.append(stun);}
      cell.append(unit);
      const badge=document.createElement("img");badge.className="unit-badge";badge.src=UNIT_ICON[tower.type]||"";badge.alt="";cell.append(badge);
    }else{
      const plus=document.createElement("b");plus.className="office-plus";plus.textContent="＋";cell.append(plus);
    }
    cell.setAttribute("aria-label","办公位"+(index+1)+" "+(tower?cardDisplay(tower).name+" "+tower.level+"级":"空位"));
  });
  overlay.querySelector(".range-indicator")?.remove();
  const range=showRadius($game().selected?.area==="formation"?$game().selected.index:-1);if(range)overlay.append(range);
}
function nodeAtMap(col,row){return{left:(col/CONFIG.board.columns*100)+"%",top:(row/CONFIG.board.rows*100)+"%"};}
function renderMapOverlays(){
  const layer=$("mapOverlay"),g=$game(),activeEnemies=new Set,activeVisuals=new Set;if(!layer)return;
  const layerW=layer.clientWidth||1,layerH=layer.clientHeight||1;
  const ordered=[...g.enemies].sort((a,b)=>a.y-b.y||a.id.localeCompare(b.id));
  const hitIds=new Set(g.visuals.filter(visual=>visual.kind==="hit-flash").map(visual=>visual.enemy_id));
  for(const enemy of g.enemies){
    activeEnemies.add(enemy.id);
    let node=layer.querySelector('[data-enemy-id="'+enemy.id+'"]');
    if(!node){node=document.createElement("div");node.dataset.enemyId=enemy.id;node.dataset.type=enemy.type;node.className="enemy";node.innerHTML='<span class="enemy-token"><b class="enemy-char"></b><img class="enemy-mini" alt=""><small class="enemy-corner"></small><small class="root-mark">责</small></span><span class="enemy-bar"><i></i></span><small class="enemy-hp"></small>';node.querySelector(".enemy-mini").src=ENEMY_ICON[enemy.type];layer.append(node);}
    // 0.8: stack only along the path (display-y). The logical y and all combat rules stay untouched.
    const stack=CONFIG.presentation.enemy_stack;
    const near=ordered.filter(other=>Math.abs(other.y-enemy.y)<=stack.window_progress);
    node.classList.toggle("clustered",near.length>1);
    const n=near.length,ordinal=near.indexOf(enemy),offset=(rank)=> (rank-(n-1)/2)*stack.offset_progress;
    const clusterMin=Math.min(...near.map(other=>other.y+offset(near.indexOf(other))));
    const clusterMax=Math.max(...near.map(other=>other.y+offset(near.indexOf(other))));
    const clusterShift=clusterMin<0?-clusterMin:clusterMax>stack.max_display_progress?stack.max_display_progress-clusterMax:0;
    const displayY=Math.max(0,Math.min(stack.max_display_progress,enemy.y+offset(ordinal)+clusterShift));
    const p=positionOnPath(displayY);
    const leftPx=p.col/CONFIG.board.columns*layerW;
    const topPx=p.row/CONFIG.board.rows*layerH;
    node.style.left=leftPx+"px";node.style.top=topPx+"px";node.style.zIndex=String(7+Math.max(0,ordinal));
    node.title=(enemy.type==="third_party_car"?"三者车主":"工地佬")+" "+enemy.hp+"/"+enemy.max_hp;
    node.classList.toggle("windup",enemy.windup_ends_ms>g.elapsed_ms);
    node.classList.toggle("slowed",g.elapsed_ms<enemy.slow_until_ms);
    node.classList.toggle("rooted",g.elapsed_ms<(enemy.root_until_ms||0));
    node.classList.toggle("hit",hitIds.has(enemy.id));
    node.querySelector(".enemy-char").textContent=ENEMY_CHAR[enemy.type];
    node.querySelector(".enemy-hp").textContent=enemy.hp+"/"+enemy.max_hp;
    node.querySelector(".enemy-bar i").style.width=Math.max(0,enemy.hp/enemy.max_hp*100)+"%";
  }
  for(const node of [...layer.querySelectorAll("[data-enemy-id]")])if(!activeEnemies.has(node.dataset.enemyId))node.remove();
  const protectedNow=g.elapsed_ms<g.inspector_protected_until_ms;
  let shield=layer.querySelector(".inspector-shield");
  if(protectedNow){
    if(!shield){shield=document.createElement("span");shield.className="inspector-shield";layer.append(shield);}
    const ip=CONFIG.board.inspector_position,pos=nodeAtMap(ip[0]+.5,ip[1]+.5);
    shield.style.left=pos.left;shield.style.top=pos.top;
    shield.textContent=((g.inspector_protected_until_ms-g.elapsed_ms)/1000).toFixed(1)+"s";
  }else shield?.remove();
  const visibleVisuals=["combat","paused"].includes(g.phase)?g.visuals:[];
  for(const visual of visibleVisuals){
    activeVisuals.add(visual.id);
    if(visual.kind==="hit-flash"||visual.kind==="leak-flash")continue;
    let node=layer.querySelector('[data-visual-id="'+visual.id+'"]');if(node)continue;
    node=document.createElement("span");node.dataset.visualId=visual.id;node.className="map-vfx vfx-"+visual.kind;
    const x=visual.x??visual.to_x??0,y=visual.y??visual.to_y??0,pos=nodeAtMap(x,y);
    node.style.left=pos.left;node.style.top=pos.top;
    if(visual.kind.endsWith("-shot")){
      node.textContent=({"car-shot":"车","rock-shot":"石","flame-shot":"火","machine-shot":"机","seal-shot":"责","wave-shot":"船"})[visual.kind]||"·";
      const start=nodeAtMap(visual.from_x,visual.from_y),end=nodeAtMap(visual.to_x,visual.to_y);
      layer.append(node);
      node.animate([{left:start.left,top:start.top},{left:end.left,top:end.top}],{duration:Math.max(160,visual.expires_ms-visual.started_ms),easing:"cubic-bezier(.3,.7,.2,1)",fill:"forwards"});
    }else{
      if(visual.kind==="point-reward")node.textContent="+1 保费";
      else if(visual.kind==="damage-float")node.textContent="-"+visual.value;
      layer.append(node);
    }
  }
  for(const node of [...layer.querySelectorAll("[data-visual-id]")])if(!activeVisuals.has(Number(node.dataset.visualId)))node.remove();
}

function renderShop(){
  if(!envelope)return;
  $("shopBalance").textContent=$profile().rebate;
  const terminal=$run().status==="terminal",persistent=isPersistent()&&!saveBlocked,shop=$("shopItems");
  shop.replaceChildren();
  for(const item of ITEM_CATALOG){
    const article=document.createElement("article");article.className="shop-item";
    const image=document.createElement("img");image.src=ITEM_ICON[item.id];image.alt=item.name;
    const copy=document.createElement("div");copy.className="shop-copy";
    const title=document.createElement("b");title.textContent=item.name;
    const effect=document.createElement("span");effect.textContent=item.effect;
    const meta=document.createElement("small");meta.append(document.createTextNode("价格 "));const priceTag=document.createElement("em");priceTag.textContent=item.price;meta.append(priceTag,document.createTextNode(" 返利 · 已有 "+$profile().inventory[item.id]+"/"+CONFIG.profile.inventory_cap_per_item));
    copy.append(title,effect,meta);
    const short=$profile().rebate<item.price,full=$profile().inventory[item.id]>=CONFIG.profile.inventory_cap_per_item;
    const reason=!persistent?(mode==="memory"?"临时试玩不保存":"只读窗口不能购买"):!terminal?"未结案不可购买":full?"库存已满":short?"返利不足":null;
    const buyCol=document.createElement("div");buyCol.className="shop-buy-col";
    const buy=document.createElement("button");buy.type="button";buy.className="shop-buy";buy.textContent=reason?"不可购买":"购买";
    buy.disabled=Boolean(reason);buy.title=reason||("用返利购买"+item.name+"，价格"+item.price+"返利");
    buy.setAttribute("aria-label","用返利购买"+item.name+"，价格"+item.price+"返利");
    buy.addEventListener("click",()=>askConfirm("purchase",{itemId:item.id}));
    buyCol.append(buy);
    if(reason){const why=document.createElement("small");why.className="shop-buy-reason";why.textContent=reason;buyCol.append(why);}
    article.append(image,copy,buyCol);shop.append(article);
  }
  $("shopAvailability").textContent=!persistent?(isPersistent()?"保存结果待核对，暂不能购买。":mode==="memory"?"临时试玩不保存，不能购买道具。":"此窗口只读，不能购买道具。"):terminal?"案件已结案：可用返利购买道具，保费不参与道具购买。":"营销部只在结案后开放，未结案不能购买。";
}
function renderItems(){
  const area=$("itemActions"),g=$game();if(!area)return;
  const sig=JSON.stringify([mode,saveBlocked?1:0,g.phase,ITEM_CATALOG.map(item=>[$profile().inventory[item.id],$run().items_used[item.id]])]);
  if(sig===lastItemSig)return;lastItemSig=sig;
  area.replaceChildren();
  for(const item of ITEM_CATALOG){
    const used=$run().items_used[item.id],stock=$profile().inventory[item.id],button=document.createElement("button");
    button.type="button";button.className="tool-btn item-tool";
    button.disabled=!canMutate()||!isPersistent()||g.phase!=="combat"||stock<=0||used>=1;
    button.title=button.disabled?(mode==="memory"?"临时试玩不能使用库存道具。":mode==="readonly"?"只读窗口不能使用道具。":g.phase!=="combat"?"战斗中才能使用。":stock<=0?"库存为0。":"本局已使用。"):item.effect;
    const icon=document.createElement("span");icon.className="tool-icon";const image=document.createElement("img");image.src=ITEM_ICON[item.id];image.alt="";icon.append(image);
    const label=document.createElement("span");label.className="tool-label";label.textContent=item.name;
    const count=document.createElement("span");count.className="tool-count";count.textContent="×"+stock;
    if(used)button.classList.add("used");
    button.append(icon,label,count);
    button.addEventListener("click",()=>askConfirm("item",{itemId:item.id}));
    area.append(button);
  }
}
function renderHearts(){
  const g=$game(),hearts=$("hearts");if(!hearts)return;
  const count=5,per=CONFIG.formation.base_hp/count,hp=Math.max(0,g.core_hp);
  if(String(hp)===lastHeartSig)return;lastHeartSig=String(hp);
  hearts.replaceChildren();
  for(let i=0;i<count;i++){
    const span=document.createElement("span");span.className="heart";
    const fill=Math.max(0,Math.min(1,(hp-i*per)/per));
    span.style.setProperty("--fill",(fill*100).toFixed(1)+"%");
    hearts.append(span);
  }
  $("healthLabel").textContent=hp;
}
function layoutBoard(){
  if(screen!=="game")return false;
  const area=document.querySelector(".board-area"),shell=document.querySelector(".board-shell");
  if(!area||!shell)return false;
  const availW=area.clientWidth-4,availH=area.clientHeight-4;
  if(availW<=0||availH<=0)return false;
  const width=Math.max(150,Math.min(availW,availH*.8));
  const key=Math.round(width)+"x"+Math.round(availH);
  if(key===boardSig)return true;boardSig=key;
  shell.style.width=Math.round(width)+"px";
  shell.style.height=Math.round(width*1.25)+"px";
  return true;
}
function showWaveBanner(text){const banner=$("waveBanner");if(!banner)return;banner.textContent=text;banner.hidden=false;banner.style.animation="none";void banner.offsetWidth;banner.style.animation="";clearTimeout(waveBannerTimer);waveBannerTimer=setTimeout(()=>{banner.hidden=true;},CONFIG.presentation.wave_banner_ms);}
function flashLeak(){const screenNode=$("gameScreen");if(!screenNode)return;screenNode.classList.remove("leak-flash");void screenNode.offsetWidth;screenNode.classList.add("leak-flash");clearTimeout(leakTimer);leakTimer=setTimeout(()=>screenNode.classList.remove("leak-flash"),CONFIG.presentation.leak_flash_ms);}
function teachingState(){const g=$game(),p=$profile();if(!g||!p||p.teaching_done!==false)return null;if(g.phase!=="prep"||g.current_wave!==1||g.settlement)return null;let step=0;if(g.formation.some(Boolean))step=2;else if(g.hand.filter(Boolean).length>CONFIG.economy.initial_hand.length)step=1;return{step,config:CONFIG.teaching.steps[step]};}
function renderTeaching(){const state=teachingState(),bar=$("teachingBar"),offers=$("offers"),start=$("startButton");
  if(!state){bar.hidden=true;offers.classList.remove("teaching-offers");start.classList.remove("teaching-start");document.querySelectorAll(".office-cell.teaching-office").forEach(cell=>cell.classList.remove("teaching-office"));return;}
  bar.hidden=false;$("teachingStep").textContent=(state.step+1)+"/"+CONFIG.teaching.steps.length;$("teachingText").textContent=state.config.text;
  offers.classList.toggle("teaching-offers",state.step===0);start.classList.toggle("teaching-start",state.step===2);
  const g=$game();document.querySelectorAll(".office-cell").forEach(cell=>{const index=Number(cell.dataset.office);const empty=!g.formation[index];cell.classList.toggle("teaching-office",state.step===1&&empty);});
}
function renderPauseOverlay(){
  const g=$game(),overlay=$("pauseOverlay");if(!overlay)return;
  const show=screen==="game"&&g.phase==="paused";
  overlay.hidden=!show;if(!show)return;
  $("pauseText").textContent="第 "+g.current_wave+"/"+CONFIG.waves.length+" 波 · 剩余来件 "+remainingEnemies(g);
  $("resumeButton").disabled=!canMutate();$("pauseCoverButton").disabled=!canMutate();
}
function renderTerminal(){
  const g=$game(),p=$profile(),terminalOverlay=$("terminalOverlay"),terminal=g.phase==="victory"||g.phase==="defeat";
  const showTerminal=terminal&&!terminalDismissed;
  terminalOverlay.hidden=!showTerminal;
  if(!terminal)return;
  const win=g.phase==="victory",settlement=g.settlement||{};
  const rating=win?(settlement.rating??null):null;
  const seal=$("ratingSeal");seal.classList.toggle("hidden",!win);
  if(win){$("ratingLetter").textContent=rating||"—";$("ratingName").textContent=ratingLabel(rating);}
  $("terminalSeal").textContent=win?"结案":"失守";
  $("terminalSeal").classList.toggle("lose",!win);
  $("terminalTitle").textContent=win?"五波守住，顺利结案":"查勘员失守";
  const stats=settlement.stats||{kills:g.diagnostics.kills,leaks:g.diagnostics.leaks,waves_cleared:g.cleared_wave_ids.length,premium_earned:g.diagnostics.premium_earned,rebate_earned:g.diagnostics.rebate_earned||0};
  const rows=[
    ["续保件数",stats.kills+" 件"],
    ["漏件数",stats.leaks+" 件"],
    ["守波数",stats.waves_cleared+"/"+CONFIG.waves.length],
    ["本局累计保费",stats.premium_earned],
    ["本局返利",stats.rebate_earned],
    ["当前保费",p.premium],
    ["当前返利",p.rebate]
  ];
  const list=$("terminalStats");list.replaceChildren(...rows.map(([label,value])=>{const li=document.createElement("li");const name=document.createElement("span");name.textContent=label;const strong=document.createElement("b");strong.textContent=String(value);li.append(name,strong);return li;}));
  $("terminalText").textContent=win?"五波全部守住，本局顺利结案。评级只用于展示，不改变保费、返利与库存；返利可在营销部购买道具。":"查勘员耐久耗尽，本局失守，没有评级。保费、返利与道具库存保留，可直接重新挑战。";
  const next=$("nextRunButton");next.textContent=win?"免费开始下一局":"重新挑战";next.disabled=!canMutate();
}
function render(){
  if(!envelope){$("coverScreen").hidden=true;$("marketingScreen").hidden=true;$("gameScreen").hidden=true;$("readOnlyScreen").hidden=screen!=="readonly";return;}
  const g=$game(),p=$profile(),r=$run(),terminal=g.phase==="victory"||g.phase==="defeat";
  $("coverScreen").hidden=screen!=="cover";$("marketingScreen").hidden=screen!=="shop";$("gameScreen").hidden=screen!=="game";$("readOnlyScreen").hidden=screen!=="readonly";
  document.querySelector(".app-shell").dataset.screen=screen;
  $("startClaimButton").textContent=terminal?"查看结案":g.phase==="paused"?"继续案件":"开始上班";
  $("startClaimButton").disabled=!canMutate();
  $("coverNote").textContent=message||(showResumeNotice?"案件已接续，进入后可明确继续战斗。":r.status==="terminal"?"案件已结案 · 可查看结果、购买或开始下一局":"未决案件 · 五波现场处置");
  $("temporaryPlayButton").hidden=mode!=="memory";
  const terminalEntry=r.status==="terminal"&&canMutate();
  $("marketingButton").disabled=!terminalEntry;
  $("marketingButton").title=terminalEntry?"":"结案后开放";
  $("coverShopReason").hidden=terminalEntry;
  $("abandonFromCoverButton").hidden=!(canMutate()&&r.status==="active"&&["prep","paused"].includes(g.phase)&&(g.current_wave>1||g.formation.some(Boolean)||g.hand.filter(Boolean).length<CONFIG.economy.initial_hand.length));
  if(screen==="shop"){renderShop();return;}
  if(screen==="readonly"){$("readOnlyMessage").textContent=message;$("readOnlySummary").textContent="保费 "+p.premium+" · 第"+g.current_wave+"波 · "+(g.phase==="combat"?"战斗记录（未推进）":phaseText(g.phase));return;}
  if(screen!=="game")return;
  const prep=isPrep(),phaseKey=[screen,g.phase,prep,mode,saveBlocked?1:0].join("|");
  if(phaseKey!==lastPhaseKey){lastPhaseKey=phaseKey;boardDirty=true;}
  $("gameScreen").classList.toggle("in-prep",prep);
  $("gameScreen").classList.toggle("is-paused",g.phase==="paused");
  $("coverButton").hidden=false;
  $("pauseButton").disabled=g.phase!=="combat"||!canMutate();
  $("modeBanner").hidden=mode==="writer"&&!saveBlocked;
  $("modeBanner").textContent=saveBlocked?"保存核对中：战斗已冻结。":mode==="memory"?message:"";
  $("saveIssue").hidden=!saveBlocked;if(saveBlocked)$("saveIssueText").textContent=saveBlocked.reason;
  renderHearts();
  $("pointsLabel").textContent=p.premium;
  $("waveLabel").textContent=terminal?(g.phase==="victory"?"结案":"失守"):"第"+g.current_wave+"/"+CONFIG.waves.length+"波";
  const ribbon=$("waveLabel").parentElement;ribbon.classList.toggle("win",g.phase==="victory");ribbon.classList.toggle("lose",g.phase==="defeat");
  buildMap();renderMapOverlays();renderTeaching();renderPauseOverlay();
  const handSig=JSON.stringify([g.hand,g.selected,mergeMode,prep,g.current_wave]);
  if(handSig!==lastHandSig){
    const hand=$("hand");hand.replaceChildren();
    for(let i=0;i<CONFIG.economy.hand_capacity;i++){const card=g.hand[i];hand.append(card?makeCard(card,{area:"hand",index:i},"hand"):makeHandSlot(i));}
    lastHandSig=handSig;
  }
  const offerSig=JSON.stringify([g.offers,g.selected,prep,g.current_wave]);
  if(offerSig!==lastOfferSig){
    const offers=$("offers");offers.replaceChildren();
    g.offers.forEach((card,index)=>offers.append(makeCard(card,{area:"offer",index},"offer")));
    lastOfferSig=offerSig;
  }
  const locked=!prep||!canMutate();
  $("offers").querySelectorAll("button").forEach(button=>{button.disabled=locked;});
  $("hand").querySelectorAll("button").forEach(button=>{button.disabled=locked;});
  $("handCount").textContent=prep?g.hand.filter(Boolean).length+"/"+CONFIG.economy.hand_capacity:"处置中";
  $("refreshButton").textContent=prep?(g.free_refresh_left>0?"换一组 · 免费":"换一组 · "+CONFIG.economy.paid_refresh_cost+"保费"):"战斗中";
  $("refreshButton").disabled=!prep||!canMutate();
  $("clearSelectionButton").hidden=!(g.selected&&prep);
  const wave=CONFIG.waves.find(item=>item.id===g.current_wave)||CONFIG.waves.at(-1);
  if(prep){
    // 0.8: no wave intel at all — the prep line is only the wave number.
    $("wavePreview").textContent="第"+g.current_wave+"波/"+CONFIG.waves.length;
  }else if(g.phase==="combat"||g.phase==="paused"){
    const alive=g.enemies.filter(enemy=>enemy.hp>0).length,notSpawned=Math.max(0,wave.spawns.length-g.spawns_done);
    $("wavePreview").textContent="剩余来件 "+remainingEnemies(g)+" = 未生成 "+notSpawned+" + 场上 "+alive;
  }else{
    $("wavePreview").textContent="本局结束 · 当前保费 "+p.premium;
  }
  const start=$("startButton");let mainLabel,subLabel,startClass="main-button",startDisabled=false,startReason="";
  if(terminal){mainLabel="查看结案";subLabel="本局已结束 · 查看统计";startClass="main-button terminal";}
  else if(g.phase==="paused"){mainLabel="继续战斗";subLabel="点击后恢复推进";startClass="main-button paused";startDisabled=!canMutate();startReason=startDisabled?"保存结果待核对":"";}
  else if(g.phase==="combat"){mainLabel="处置中";subLabel="剩余来件 "+remainingEnemies(g);startClass="main-button combat";startDisabled=true;startReason="战斗中不可开始下一波";}
  else{mainLabel="开始第"+g.current_wave+"波";subLabel="守住 +"+CONFIG.economy.wave_clear_reward+" 保费";startDisabled=!canMutate();startReason=startDisabled?(saveBlocked?"保存结果待核对":mode==="memory"?"临时试玩":mode==="readonly"?"只读窗口":"当前不能操作"):"";}
  start.className=startClass;start.disabled=startDisabled;
  const startKey=mainLabel+"|"+subLabel;
  if(start.dataset.label!==startKey){start.replaceChildren();const b=document.createElement("b");b.textContent=mainLabel;const small=document.createElement("small");small.textContent=subLabel;start.append(b,small);start.dataset.label=startKey;}
  // 0.8: selection/merge guidance stays in the operation area, never in #wavePreview.
  let operationHint=startReason?("不可操作："+startReason):"";
  if(!operationHint&&prep&&g.selected)operationHint=mergeMode?"合成模式：再点同类同级条款，或点兼容办公位":"已选"+cardDisplay(cardAtRef(g.selected)).name+"；点亮起的办公位布置。";
  $("commandHint").hidden=!operationHint;$("commandHint").textContent=operationHint;
  const merge=$("mergeButton");merge.disabled=!g.selected||g.selected.area!=="hand"||!prep||!canMutate();
  merge.title=merge.disabled?"先选一份待启用条款才能合成":("合成"+cardDisplay(cardAtRef(g.selected)).name);
  merge.querySelector("span").textContent=mergeMode?"×":"合";merge.querySelector("small").textContent=mergeMode?"取消":"合成";
  $("salvageButton").disabled=!g.selected||g.selected.area==="offer"||!prep||!canMutate();
  $("salvageButton").title=$("salvageButton").disabled?"先选一份已布置或待启用条款才能回收":"回收所选条款";
  renderItems();
  // 0.8: shop only opens after a terminal run; the locked entry shows a visible reason.
  const shopTool=$("shopToolButton"),shopLocked=r.status!=="terminal";
  shopTool.disabled=shopLocked||!canMutate();
  shopTool.title=shopLocked?"结案后开放":"营销部（结案后）";
  let lockText=shopTool.querySelector(".tool-sub");
  if(shopLocked){if(!lockText){lockText=document.createElement("small");lockText.className="tool-sub";shopTool.append(lockText);}lockText.textContent="结案后开放";}
  else lockText?.remove();
  if(boardDirty){if(layoutBoard())boardDirty=false;}
  renderTerminal();
  if(g.phase==="prep"&&g.current_wave>observedWave&&observedWave>0)showWaveBanner("第"+observedWave+"波守住");
  observedWave=g.current_wave;
  if(!terminal&&g.diagnostics.leaks>lastLeakCount){flashLeak();}
  lastLeakCount=g.diagnostics.leaks;
  const logSig=g.log.slice(0,10).join("|");
  if(logSig!==lastLogSig){lastLogSig=logSig;$("log").replaceChildren(...g.log.slice(0,10).map(line=>{const li=document.createElement("li");li.textContent=line;return li;}));}
}
function selectedCard(){return cardAtRef($game()?.selected);}
function showCover(){if(!$game())return;if($game().phase==="combat"){const ok=runUserAction("pause",{source:"cover"},draft=>{draft.game.phase="paused";return{ok:true};},"案件已暂停并保存。");if(!ok)return;}screen="cover";mergeMode=false;describe(null);closeSheet();render();}
function showGame(){if(!$game())return;screen="game";$game().selected=null;mergeMode=false;describe(null);closeSheet();boardSig="";boardDirty=true;render();if(showResumeNotice){$say($game().phase==="paused"?"案件已准确接续并暂停；点“继续战斗”后才会开打。":"案件已接续。");showResumeNotice=false;}}
function showShop(returnTo){if(!$game())return;if($run().status!=="terminal"||!["victory","defeat"].includes($game().phase)){$say("结案后开放");return;}shopReturn=returnTo;screen="shop";closeSheet();render();}
function closeShop(){screen=shopReturn==="game"?"game":"cover";boardSig="";boardDirty=true;render();}
function openSheet(which){const layer=$("sheetLayer");if(!layer)return;layer.hidden=false;const details=$("detailsDisclosure");if(which==="help")details.open=true;else if(which==="log")details.open=false;layer.querySelector(".sheet").scrollTop=which==="log"?260:0;}
function closeSheet(){const layer=$("sheetLayer");if(layer)layer.hidden=true;}
function dismissTerminal(){terminalDismissed=true;render();}
function doStartWave(){if(!$game())return;if(["victory","defeat"].includes($game().phase)){terminalDismissed=false;render();return;}if($game().phase==="paused"){runUserAction("continue-combat",{run_id:$run().run_id},draft=>{draft.game.phase="combat";return{ok:true};},"战斗继续。");lastFrame=performance.now();accumulator=0;return;}if($game().phase!=="prep")return;
  const wave=$game().current_wave,ok=runUserAction("start-wave",{wave},draft=>{startWave(draft.game);if(!draft.profile.teaching_done)draft.profile.teaching_done=true;return{ok:true};},"第"+wave+"波开始。");
  if(ok)showWaveBanner("第"+wave+"波开始");lastFrame=performance.now();accumulator=0;}
function requestNewRun(){askConfirm("new-run");}
function pauseForLifecycle(){if(!envelope||saveBlocked||$game().phase!=="combat")return;if(mode==="memory"){$game().phase="paused";accumulator=0;lastFrame=performance.now();render();return;}if(mode!=="writer")return;const previous=envelope,candidate=clone(envelope);candidate.game.phase="paused";const result=commitCandidate(previous,candidate);accumulator=0;lastFrame=performance.now();if(!result.ok)$say("后台暂停未能保存，战斗已冻结，请核对保存结果。");render();}
function openShopFromTerminal(){showShop("game");}
function skipTeaching(){runUserAction("teaching-skip",{source:"skip"},draft=>{draft.profile.teaching_done=true;return{ok:true};},"已跳过首局教学。");}
function frame(now){const dt=Math.max(0,now-lastFrame);lastFrame=now;if(dt>100)storageMetrics.longFrames++;if(mode==="writer"||mode==="memory"){
    if($game()?.phase==="combat"&&!modalIntent&&!saveBlocked){accumulator+=dt;const step=CONFIG.simulation.tick_ms,steps=Math.min(Math.floor(accumulator/step),CONFIG.simulation.max_catchup_ticks_per_frame);if(steps>0){const previous=envelope,candidate=clone(envelope);let done=0;for(;done<steps&&candidate.game.phase==="combat";done++){const result=tick(candidate.game,candidate.profile,candidate.run);if(result?.ok===false)break;}if(done>0){const saved=commitCandidate(previous,candidate);if(saved.ok){accumulator-=done*step;storageMetrics.ticks+=done;lastFrame=performance.now();}else{accumulator=0;$say(saved.reason+"战斗已暂停。");}}else accumulator=0;render();}}
  }requestAnimationFrame(frame);}

$("startClaimButton").addEventListener("click",()=>showGame());$("temporaryPlayButton").addEventListener("click",()=>showGame());$("startButton").addEventListener("click",doStartWave);$("pauseButton").addEventListener("click",pauseForLifecycle);$("coverButton").addEventListener("click",showCover);$("marketingButton").addEventListener("click",()=>showShop("cover"));$("terminalShopButton").addEventListener("click",openShopFromTerminal);$("marketingBackButton").addEventListener("click",closeShop);$("nextRunButton").addEventListener("click",requestNewRun);$("abandonFromCoverButton").addEventListener("click",requestNewRun);$("mergeButton").addEventListener("click",()=>{if(mergeMode){mergeMode=false;$say("已退出合成模式。");render();}else startMergeMode();});$("clearSelectionButton").addEventListener("click",()=>clearSelection("已取消条款选择。"));$("salvageButton").addEventListener("click",()=>{if($game().selected)askConfirm("salvage",{ref:$game().selected});});$("refreshButton").addEventListener("click",()=>runUserAction("refresh-offers",{},draft=>refreshOffers(draft.game,draft.profile),"已更换条款组。"));$("reconcileButton").addEventListener("click",reconcileSave);$("confirmAccept").addEventListener("click",completeModalAction);$("confirmCancel").addEventListener("click",closeConfirm);$("shopToolButton").addEventListener("click",()=>showShop("game"));$("logToolButton").addEventListener("click",()=>openSheet("log"));$("helpToolButton").addEventListener("click",()=>openSheet("help"));$("sheetCloseButton").addEventListener("click",closeSheet);$("terminalCloseButton").addEventListener("click",dismissTerminal);$("teachingSkip").addEventListener("click",skipTeaching);$("resumeButton").addEventListener("click",doStartWave);$("pauseCoverButton").addEventListener("click",showCover);
$("sheetLayer").addEventListener("click",event=>{if(event.target===$("sheetLayer"))closeSheet();});
window.addEventListener("resize",()=>{boardSig="";boardDirty=true;if(mode!=="booting")render();});
document.addEventListener("visibilitychange",()=>{if(document.hidden){stopPointerDrag(true);pauseForLifecycle();}else{lastFrame=performance.now();accumulator=0;}});globalThis.wx?.onHide?.(()=>pauseForLifecycle());globalThis.wx?.onShow?.(()=>{lastFrame=performance.now();accumulator=0;});window.addEventListener("pagehide",()=>{pauseForLifecycle();if(lockRelease){lockRelease();lockRelease=null;}});
// Self-test-only metrics surface (no UI, read-only): used by browser verification for frame/save evidence.
globalThis.__liLePeiMetrics=()=>({mode,screen,phase:$game()?.phase||null,ticks:storageMetrics.ticks,writes:storageMetrics.writes,lastSaveMs:Math.round(storageMetrics.lastMs*100)/100,maxSaveMs:Math.round(storageMetrics.maxMs*100)/100,longFrames:storageMetrics.longFrames,serializedBytes:storageMetrics.serializedBytes});
// Replaced by the lock callback after initialization; this guard prevents a pre-lock render.
setTimeout(()=>{if(mode==="booting")boot();},0);
