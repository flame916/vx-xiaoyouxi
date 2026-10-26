import SPEC from "./insurance-config.json?v=1.0.0" with { type: "json" };

export const CONFIG = SPEC;
const ATTACK_TEXT={
  car_damage:"全损车冲击并爆炸，造成范围伤害。",
  construction:"边坡落石造成范围伤害与减速。",
  property:"基本险火灾持续3秒，每0.5秒造成一次伤害。",
  machine_damage:"过载冲击，短射程高单体伤害。",
  liability:"定责拦截：命中缠绷带定身 0.8 秒；对客户（人伤）造成 1.5 倍伤害。",
  marine:"水波横扫，全场最远的大范围伤害。"
};
export const INSURANCES = Object.fromEntries(SPEC.towers.map(t => [t.id, {
  name:t.name, glyph:t.glyph, attack:ATTACK_TEXT[t.id]||"未知险种。", equipment:t.equipment_id?EQUIPMENT_LABEL_TEXT():null
}]));
function EQUIPMENT_LABEL_TEXT(){return "基本";}
// equipment mapping comes from the config (six towers); no hard-coded three-tower map.
const EQUIPMENT_BY_TYPE=Object.fromEntries(CONFIG.towers.map(tower=>[tower.id,tower.equipment_id??null]));
const EQUIPMENT_LABEL=Object.fromEntries([["basic","基本"],...CONFIG.equipment.types.map(t=>[t.id,t.name])]);
const EQUIPMENT_IDS=CONFIG.equipment.types.map(t=>t.id);
const EQUIPMENT_SPECS=Object.fromEntries(CONFIG.equipment.types.map(t=>[t.id,t]));
const MAX_SLOTS=CONFIG.economy.expansion.max_slot_count, FIXED_SLOTS=CONFIG.economy.expansion.fixed_slot_count, PADS=CONFIG.board.expansion_pads;
function equipmentLabel(id){return EQUIPMENT_LABEL[id]||"基本";}
const WAVE_BY_ID=new Map(CONFIG.waves.map(wave=>[wave.id,wave]));
const ENEMY_BY_ID=new Map(CONFIG.enemies.map(enemy=>[enemy.id,enemy]));
const TOWER_BY_ID=new Map(CONFIG.towers.map(tower=>[tower.id,tower]));
const OFFICE_POSITIONS=CONFIG.board.office_positions;
const PROFILE_KEY=CONFIG.persistence.authoritative_key;
const PROFILE_FORMAT=CONFIG.persistence.format_id;
const IMPORT_SOURCES=[...CONFIG.persistence.import_from].sort((a,b)=>a.priority-b.priority);
const INVENTORY_IDS=Object.keys(CONFIG.items);
const DIAGNOSTIC_KEYS=["attacks","kills","stuns","leaks","premium_earned"];
const DIAGNOSTIC_KEYS_08=DIAGNOSTIC_KEYS.concat("rebate_earned");
// 0.9: purchase price depends on the current wave; buy_cost stays as the legacy fallback.
export function buyCostForWave(wave){
  const table=CONFIG.economy.buy_cost_by_wave;
  return Array.isArray(table)&&Number.isInteger(table[wave-1])?table[wave-1]:CONFIG.economy.buy_cost;
}
export function validateConfigIntegrity(){
  const towers=CONFIG.towers||[];
  if(towers.length!==6||new Set(towers.map(t=>t.id)).size!==6)return{ok:false,reason:"towers must contain six unique ids"};
  if(!towers.every(t=>t.damage_by_level.length===CONFIG.economy.max_level))return{ok:false,reason:"five damage levels expected"};
  if(!Array.isArray(CONFIG.economy.buy_cost_by_wave)||CONFIG.economy.buy_cost_by_wave.length!==CONFIG.waves.length||!CONFIG.economy.buy_cost_by_wave.every(v=>Number.isInteger(v)&&v>=0))return{ok:false,reason:"bad buy_cost_by_wave"};
  if(!Array.isArray(CONFIG.economy.offer_pool)||CONFIG.economy.offer_pool.length!==CONFIG.economy.offer_weights.length||!CONFIG.economy.offer_weights.every(v=>v>0))return{ok:false,reason:"bad offer pool/weights"};
  if(CONFIG.waves.length!==10)return{ok:false,reason:"ten waves expected"};
  const enemies=CONFIG.enemies||[];
  if(enemies.length!==5||new Set(enemies.map(e=>e.id)).size!==5)return{ok:false,reason:"five enemies expected"};
  if(!["third_party_car","foreman","foreman_boss","ship_owner","complaint"].every(id=>enemies.some(e=>e.id===id)))return{ok:false,reason:"missing enemy id"};
  if(!enemies.every(e=>["small","elite","boss"].includes(e.tier)&&typeof e.human_injury==="boolean"&&(!e.hp_scaling||e.hp_scaling==="flat")))return{ok:false,reason:"bad enemy tier/human_injury/hp_scaling"};
  if(enemies.filter(e=>e.human_injury).map(e=>e.id).join(",")!=="third_party_car")return{ok:false,reason:"human_injury only on third_party_car"};
  if(!Array.isArray(CONFIG.boss.enemy_ids)||!CONFIG.boss.enemy_ids.every(id=>enemies.some(e=>e.id===id&&e.tier==="boss")))return{ok:false,reason:"boss ids must be boss-tier enemies"};
  if(CONFIG.boss.enemy_ids.length!==3||!CONFIG.boss.enemy_ids.includes("complaint"))return{ok:false,reason:"complaint boss missing"};
  if(CONFIG.boss.banner_ms!==2000||CONFIG.boss.pause_simulation!==false||CONFIG.boss.banner_text!=="大案来了")return{ok:false,reason:"bad boss banner"};
  for(const wave of CONFIG.waves)for(const spawn of wave.spawns){const spec=enemies.find(e=>e.id===spawn.enemy);if(!spec)return{ok:false,reason:"spawn enemy not in roster"};if(spawn.hp_override!==undefined&&(spec.tier!=="boss"||!Number.isInteger(spawn.hp_override)||spawn.hp_override<=0))return{ok:false,reason:"hp_override only on bosses"};}
  const e=CONFIG.economy.expansion;if(!e||e.fixed_slot_count!==6||e.max_slot_count!==8||JSON.stringify(e.costs_by_index)!==JSON.stringify([5,8])||CONFIG.board.expansion_pads.length!==4)return{ok:false,reason:"bad expansion config"};
  if(!CONFIG.equipment||CONFIG.equipment.types.length!==3||!CONFIG.equipment.types.every(x=>["reinforce","aim","rush"].includes(x.id)))return{ok:false,reason:"bad equipment config"};
  if(!Array.isArray(CONFIG.salvage.refund_cap_by_level)||CONFIG.salvage.refund_cap_by_level.length!==5)return{ok:false,reason:"bad salvage caps"};
  return{ok:true};
}

function clone(value){return JSON.parse(JSON.stringify(value));}
function normalizeSeed(seed){const n=Number(seed)>>>0;return n||1;}
function entityId(game){return "e"+String(game.next_entity_id++).padStart(8,"0");}
function makeCard(game,type,level=1,equipment=EQUIPMENT_BY_TYPE[type],salvageCredit=CONFIG.salvage.free_card_credit){return{id:entityId(game),type,level,equipment_id:equipment,salvage_credit:salvageCredit};}
function appendLog(game,text){game.log.unshift(text);if(game.log.length>30)game.log.length=30;}
function enemyDisplayName(spec){return spec.tier==="boss"?spec.name+"·大案":spec.name;}
function officePositionsFor(game){return OFFICE_POSITIONS.concat((game.pad_choices||[]).map(i=>PADS[i]));}
function posForOffice(index,game){const positions=game?officePositionsFor(game):OFFICE_POSITIONS;const [col,row]=positions[index]||[];return col===undefined?null:{col:col+.5,row:row+.5};}
function distance(a,b){return Math.hypot(a.col-b.col,a.row-b.row);}
export function positionOnPath(progress){
  const path=CONFIG.board.path;
  const p=Math.max(0,Math.min(100000,progress))/100000*(path.length-1);
  const index=Math.min(path.length-2,Math.floor(p)),fraction=p-index;
  const [c0,r0]=path[index],[c1,r1]=path[index+1];
  return{col:c0+(c1-c0)*fraction+.5,row:r0+(r1-r0)*fraction+.5};
}
export function nextUint32(game){let x=game.rng_state>>>0;x^=x<<13;x^=x>>>17;x^=x<<5;x>>>=0;game.rng_state=x||1;return game.rng_state;}
function drawType(game){const pool=CONFIG.economy.offer_pool,weights=CONFIG.economy.offer_weights,total=weights.reduce((sum,weight)=>sum+weight,0);let draw=Math.floor(nextUint32(game)/4294967296*total);for(let i=0;i<pool.length;i++){draw-=weights[i];if(draw<0)return pool[i];}return pool.at(-1);}
function makeOffer(game,type){return makeCard(game,type,CONFIG.economy.offer_level);}
function rebateGain(game,profile){
  if(!CONFIG.economy.rebate.enabled)return 0;
  const base=CONFIG.economy.rebate.base;
  const value=base==="wave_earned"?game.wave_premium_earned:base==="wave_spent"?game.wave_premium_spent:profile.premium;
  const gain=Math.floor(value*CONFIG.economy.rebate.rate);
  return Math.max(0,Math.min(gain,CONFIG.profile.rebate_cap-profile.rebate));
}
function creditRebate(game,profile){
  const gain=rebateGain(game,profile);if(gain<=0)return 0;
  profile.rebate+=gain;game.diagnostics.rebate_earned+=gain;return gain;
}

// ---- rating / settlement -------------------------------------------------
export function ratingFor(coreHp){
  if(!Number.isInteger(coreHp)||coreHp<=0)return null;
  const hit=CONFIG.rating.thresholds.find(row=>coreHp>=row.min_hp&&coreHp<=row.max_hp);
  return hit?hit.grade:null;
}
export function ratingLabel(rating){
  if(rating===null)return CONFIG.rating.defeat.label;
  const hit=CONFIG.rating.thresholds.find(row=>row.grade===rating);
  return hit?hit.label:"";
}
export function statsFor(game){
  return{
    kills:game.diagnostics.kills,
    leaks:game.diagnostics.leaks,
    waves_cleared:game.cleared_wave_ids.length,
    premium_earned:game.diagnostics.premium_earned,
    rebate_earned:game.diagnostics.rebate_earned||0,
    equipment_dropped:game.equipment_dropped_run||0
  };
}
export function settlementFor(game){
  const terminal=game.phase==="victory"||game.phase==="defeat";
  if(!terminal)return null;
  const result=game.phase;
  return{wave:game.current_wave,result,rating:result==="victory"?ratingFor(game.core_hp):null,stats:statsFor(game)};
}

export function createGame(seed=CONFIG.simulation.default_seed){
  const initialSeed=normalizeSeed(seed);
  const game={
    schema_version:CONFIG.schema_version,config_version:CONFIG.config_version,
    phase:"prep",initial_seed:initialSeed,rng_state:initialSeed,current_wave:1,
    cleared_wave_ids:[],core_hp:CONFIG.formation.base_hp,inspector_protected_until_ms:0,
    hand:Array(CONFIG.economy.hand_capacity).fill(null),formation:Array(FIXED_SLOTS).fill(null),slot_count:FIXED_SLOTS,pad_choices:[],expansion_used_wave:0,equipment_pity:0,equipment_dropped_run:0,
    offers:[],free_refresh_left:CONFIG.economy.free_refresh_per_prep,next_entity_id:1,next_event_seq:1,next_visual_id:1,
    tick_index:0,elapsed_ms:0,wave_elapsed_ms:0,spawns_done:0,enemies:[],effects:[],visuals:[],selected:null,
    operation_seq:0,operations:[],settlement:null,wave_premium_earned:0,wave_premium_spent:0,
    log:["选择条款，再点亮的办公位；合成需要单独操作。"],diagnostics:{attacks:0,kills:0,stuns:0,leaks:0,premium_earned:0,rebate_earned:0}
  };
  for(const type of CONFIG.economy.initial_hand){const card=makeCard(game,type);const i=game.hand.findIndex(item=>item===null);game.hand[i]=card;}
  for(const type of CONFIG.economy.initial_offers)game.offers.push(makeOffer(game,type));
  return game;
}
function newProfileId(){return globalThis.crypto?.randomUUID?.()||("profile-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,10));}
function blankInventory(){return Object.fromEntries(INVENTORY_IDS.map(id=>[id,0]));}
export function createEnvelope(seed=CONFIG.simulation.default_seed,{profileId=newProfileId(),premium=CONFIG.profile.first_grant,grantApplied=true,teachingDone=false,rebate=0}={}){
  const runSeq=1,game=createGame(seed);return{format_id:PROFILE_FORMAT,envelope_schema_version:CONFIG.persistence.envelope_schema_version,config_version:CONFIG.config_version,revision:0,profile:{profile_id:profileId,premium,rebate,inventory:blankInventory(),equipment_owned:{reinforce:0,aim:0,rush:0},first_grant_applied:grantApplied,teaching_done:teachingDone,teaching_stage:teachingDone?CONFIG.teaching.stages_total:0,import_source:null,action_seq:0,receipts:[]},run:{run_seq:runSeq,run_id:profileId+":run:"+runSeq,status:"active",closed_run_seq:0,items_used:blankInventory()},game};
}
export function nextActionId(envelope){return envelope.profile.profile_id+":"+(envelope.profile.action_seq+1);}
export function receiptFor(envelope,actionId){return envelope.profile.receipts.find(item=>item.action_id===actionId)||null;}
export function actionAlreadyProcessed(envelope,actionId){const sequence=Number(actionId?.slice(actionId.lastIndexOf(":")+1));return Boolean(receiptFor(envelope,actionId))||(Number.isSafeInteger(sequence)&&sequence<=envelope.profile.action_seq);}
function recordReceipt(envelope,actionId,type,details={}){const sequence=Number(actionId.slice(actionId.lastIndexOf(":")+1));envelope.profile.action_seq=sequence;envelope.profile.receipts.push({action_id:actionId,type,details,run_id:envelope.run.run_id,revision:envelope.revision+1});if(envelope.profile.receipts.length>CONFIG.profile.receipt_limit)envelope.profile.receipts.splice(0,envelope.profile.receipts.length-CONFIG.profile.receipt_limit);}
export function recordAction(envelope,actionId,type,details={}){const prior=receiptFor(envelope,actionId);if(prior){const same=prior.type===type&&JSON.stringify(prior.details)===JSON.stringify(details);return{ok:false,duplicate:true,same_payload:same,receipt:prior,reason:same?"这个操作已处理。":"操作编号已用于其他内容。"};}if(actionAlreadyProcessed(envelope,actionId))return{ok:false,reason:"操作序号已过期，请刷新后重试。"};const expected=nextActionId(envelope);if(actionId!==expected)return{ok:false,reason:"操作序号已过期，请刷新后重试。"};recordReceipt(envelope,actionId,type,details);return{ok:true};}
export function startNextRun(envelope,seed=envelope.game.initial_seed,actionId=null){
  if(!actionId)return{ok:false,reason:"缺少操作编号，未开始新局。"};
  const prior=receiptFor(envelope,actionId);if(prior){const same=prior.type==="new-run"&&prior.details?.seed===seed;return{ok:false,duplicate:true,same_payload:same,receipt:prior,reason:same?"这个操作已处理。":"操作编号已用于其他内容。"};}if(actionAlreadyProcessed(envelope,actionId))return{ok:false,reason:"操作序号已过期，请刷新后重试。"};if(actionId!==nextActionId(envelope))return{ok:false,reason:"操作序号已过期，请刷新后重试。"};
  if(!validateEnvelope(envelope))return{ok:false,reason:"案卷无效，未开始新局。"};if(envelope.run.status==="active"&&!["prep","paused"].includes(envelope.game.phase))return{ok:false,reason:"请先暂停当前案件，再重开。"};
  const draft=clone(envelope),previous=clone(draft.run);previous.status=previous.status==="terminal"?"closed":"abandoned";draft.run={run_seq:previous.run_seq+1,run_id:draft.profile.profile_id+":run:"+(previous.run_seq+1),status:"active",closed_run_seq:previous.run_seq,items_used:blankInventory()};draft.game=createGame(seed);recordReceipt(draft,actionId,"new-run",{from_run:previous.run_id,to_run:draft.run.run_id,seed});return{ok:true,envelope:draft};
}
export function cardDisplay(card){
  const info=INSURANCES[card.type]||{name:card.type,glyph:"?",attack:"未知险种。"};
  return{id:card.id,name:info.name,glyph:info.glyph,level:card.level,equipment:equipmentLabel(card.equipment_id),equipment_id:card.equipment_id,attack:info.attack};
}
function indexOfRef(ref,game){
  if(!ref||!["hand","formation","offer"].includes(ref.area))return-1;
  const list=ref.area==="hand"?game.hand:ref.area==="formation"?game.formation:game.offers;
  return Number.isInteger(ref.index)&&ref.index>=0&&ref.index<list.length?ref.index:-1;
}
function listAt(game,area){return area==="hand"?game.hand:area==="formation"?game.formation:game.offers;}
function recordOperation(game,action,source,target){game.operation_seq++;game.operations.push({seq:game.operation_seq,wave:game.current_wave,action,source:source||null,target:target||null,rng_state:game.rng_state});if(game.operations.length>200)game.operations.shift();}
function gameSaveInto(game,draft){for(const key of Object.keys(game))delete game[key];Object.assign(game,draft);}
function canMerge(a,b){
  if(a.type!==b.type||a.level!==b.level)return"只能合成同类、同级条款。";
  if(a.level>=CONFIG.economy.max_level)return"已到五级上限，无法继续合成。";
  return null;
}
export function moveEntity(game,source,target){
  if(game.phase!=="prep")return{ok:false,reason:"布防阶段才能调整条款。"};
  const si=indexOfRef(source,game),ti=indexOfRef(target,game);
  if(si<0||ti<0||source.area==="offer"||target.area==="offer")return{ok:false,reason:"来源或目标格无效。"};
  if(source.area===target.area&&source.index===target.index)return{ok:false,reason:"不能将条款移到自身。"};
  const sourceList=listAt(game,source.area),targetList=listAt(game,target.area),a=sourceList[si],b=targetList[ti];
  if(!a)return{ok:false,reason:"来源条款已不存在。"};
  if(b)return{ok:false,reason:"目标已占用。合成请先选条款，再使用“合成”操作。"};
  if(target.area==="formation"&&!['hand','formation'].includes(source.area))return{ok:false,reason:"只能从待启用条款或其他办公位布置到空办公位。"};
  const draft=clone(game),from=listAt(draft,source.area),to=listAt(draft,target.area);
  to[ti]=a;from[si]=null;draft.selected=null;recordOperation(draft,"move",source,target);gameSaveInto(game,draft);return{ok:true,moved:true};
}
export function mergeEntities(game,source,target){
  if(game.phase!=="prep")return{ok:false,reason:"布防阶段才能合成。"};
  const si=indexOfRef(source,game),ti=indexOfRef(target,game);
  if(si<0||ti<0||source.area!=="hand"||target.area==="offer"||sameRef(source,target))return{ok:false,reason:"合成目标无效。请从待启用条款开始。"};
  const sourceList=listAt(game,source.area),targetList=listAt(game,target.area),a=sourceList[si],b=targetList[ti];
  if(!a||!b)return{ok:false,reason:"需要两份已存在的条款才能合成。"};
  const reason=canMerge(a,b);if(reason)return{ok:false,reason};
  const draft=clone(game),from=listAt(draft,source.area),to=listAt(draft,target.area);
  const nextLevel=a.level+1;const cap=CONFIG.salvage.refund_cap_by_level[nextLevel-1]||0;const equipment=b.equipment_id&&b.equipment_id!=="basic"?b.equipment_id:(a.equipment_id&&a.equipment_id!=="basic"?a.equipment_id:EQUIPMENT_BY_TYPE[a.type]);
  to[ti]={id:entityId(draft),type:a.type,level:nextLevel,equipment_id:equipment,salvage_credit:Math.min(cap,(a.salvage_credit||0)+(b.salvage_credit||0))};from[si]=null;draft.selected=null;
  recordOperation(draft,"merge",source,target);appendLog(draft,INSURANCES[a.type].name+"升至"+(a.level+1)+"级。");gameSaveInto(game,draft);return{ok:true,merged:true};
}
// 0.7 kept a buy-and-place helper; 0.8 never wires it (kept only as dead code for rollback reference).
export function placeOffer(game,profile,offerIndex,officeIndex){
  if(game.phase!=="prep")return{ok:false,reason:"战斗中不能布置条款。"};
  if(!Number.isInteger(officeIndex)||officeIndex<0||officeIndex>=game.formation.length)return{ok:false,reason:"所选办公位无效。"};
  if(game.formation[officeIndex])return{ok:false,reason:"这个办公位已有条款，请选空位。"};
  if(!Number.isInteger(offerIndex)||offerIndex<0||offerIndex>=game.offers.length)return{ok:false,reason:"所选条款无效。"};
  const price=buyCostForWave(game.current_wave);
  if(profile.premium<price)return{ok:false,reason:"保费不足，未扣费也未改变条款。"};
  const offer=game.offers[offerIndex];if(!offer||offer.level!==1||!CONFIG.economy.offer_pool.includes(offer.type))return{ok:false,reason:"所选条款无效。"};
  const draft=clone(game),profileDraft=clone(profile),card=draft.offers[offerIndex],target={area:"formation",index:officeIndex};
  profileDraft.premium-=price;card.salvage_credit=CONFIG.salvage.purchased_level_one_credit;draft.formation[officeIndex]=card;draft.offers[offerIndex]=makeOffer(draft,drawType(draft));draft.selected=null;
  recordOperation(draft,"buy-and-place",{area:"offer",index:offerIndex},target);appendLog(draft,"布置"+INSURANCES[card.type].name+"，支出"+price+"保费。");gameSaveInto(game,draft);Object.assign(profile,profileDraft);return{ok:true,card};
}
export function buyOffer(game,profile,index){
  if(game.phase!=="prep")return{ok:false,reason:"战斗中不能启用条款。"};
  if(!Number.isInteger(index)||index<0||index>=game.offers.length)return{ok:false,reason:"条款选择项无效。"};
  const handIndex=game.hand.findIndex(card=>card===null);
  const price=buyCostForWave(game.current_wave);
  if(handIndex<0)return{ok:false,reason:"待启用栏已满 8/8：先布置、合成或回收一份条款，再选用。"};
  if(profile.premium<price)return{ok:false,reason:"保费不足：本波选用一份条款需要 "+price+" 保费。"};
  const offer=game.offers[index];if(!offer||offer.level!==1||!CONFIG.economy.offer_pool.includes(offer.type))return{ok:false,reason:"所选条款无效。"};
  const draft=clone(game),profileDraft=clone(profile),card=draft.offers[index];
  profileDraft.premium-=price;card.salvage_credit=CONFIG.salvage.purchased_level_one_credit;
  draft.hand[handIndex]=card;draft.offers[index]=makeOffer(draft,drawType(draft));draft.wave_premium_spent+=price;
  recordOperation(draft,"buy",{area:"offer",index},{area:"hand",index:handIndex});appendLog(draft,"选用"+INSURANCES[card.type].name+"条款，支出"+price+"保费。");gameSaveInto(game,draft);Object.assign(profile,profileDraft);return{ok:true,handIndex,card,price};
}
export function purchaseItem(game,profile,run,itemId){
  if(CONFIG.shop.uses_premium!==false)return{ok:false,reason:"商店货币配置错误。"};
  if(!["victory","defeat"].includes(game.phase)||run.status!=="terminal"||run.closed_run_seq!==run.run_seq)return{ok:false,reason:"本局结案后才能购买道具。"};
  const priceById={zero_settlement:CONFIG.shop.zero_settlement_price,deny_claim:CONFIG.shop.deny_claim_price,outside_liability:CONFIG.shop.outside_liability_price},price=priceById[itemId];
  if(!Number.isSafeInteger(price))return{ok:false,reason:"道具无效。"};
  if(!Number.isInteger(profile.inventory[itemId])||profile.inventory[itemId]>=CONFIG.profile.inventory_cap_per_item)return{ok:false,reason:"该道具库存已满。"};
  if(profile.rebate<price)return{ok:false,reason:"返利不足，未完成购买。"};
  const draftGame=clone(game),draftProfile=clone(profile);draftProfile.rebate-=price;draftProfile.inventory[itemId]++;appendLog(draftGame,"购买"+CONFIG.items[itemId].name+"，支出"+price+"返利。");gameSaveInto(game,draftGame);Object.assign(profile,draftProfile);return{ok:true,itemId,price,balance:profile.rebate,stock:profile.inventory[itemId]};
}
export function refreshOffers(game,profile){
  if(game.phase!=="prep")return{ok:false,reason:"战斗期间不能刷新。"};
  const free=game.free_refresh_left>0;if(!free&&profile.premium<CONFIG.economy.paid_refresh_cost)return{ok:false,reason:"保费不足，未更换条款组。"};
  const draft=clone(game),profileDraft=clone(profile);if(free)draft.free_refresh_left--;else{profileDraft.premium-=CONFIG.economy.paid_refresh_cost;draft.wave_premium_spent+=CONFIG.economy.paid_refresh_cost;}
  draft.offers=draft.offers.map(()=>makeOffer(draft,drawType(draft)));draft.selected=null;recordOperation(draft,free?"free-refresh":"paid-refresh",null,null);appendLog(draft,free?"已免费更换本波条款组。":"已更换条款组，支出"+CONFIG.economy.paid_refresh_cost+"保费。");gameSaveInto(game,draft);Object.assign(profile,profileDraft);return{ok:true,free};
}
export function salvage(game,profile,ref,confirm=true){
  if(game.phase!=="prep")return{ok:false,reason:"战斗期间不能回收。"};if(!confirm)return{ok:false,reason:"已取消回收。"};
  const i=indexOfRef(ref,game);if(i<0||ref.area==="offer")return{ok:false,reason:"回收目标无效。"};
  const list=listAt(game,ref.area),card=list[i];if(!card)return{ok:false,reason:"回收目标已不存在。"};
  const cap=CONFIG.salvage.refund_cap_by_level[card.level-1]||0,refund=Math.min(cap,card.salvage_credit||0,CONFIG.profile.premium_cap-profile.premium),draft=clone(game),profileDraft=clone(profile);listAt(draft,ref.area)[i]=null;draft.selected=null;profileDraft.premium+=refund;draft.diagnostics.premium_earned+=refund;recordOperation(draft,"salvage",ref,null);appendLog(draft,"回收"+INSURANCES[card.type].name+"条款，返还"+refund+"保费。");gameSaveInto(game,draft);Object.assign(profile,profileDraft);return{ok:true,refund,credit:card.salvage_credit||0};
}
function sameRef(a,b){return a&&b&&a.area===b.area&&a.index===b.index;}
export function expansionCost(game){if(game.slot_count>=MAX_SLOTS)return null;return CONFIG.economy.expansion.costs_by_index[game.slot_count-FIXED_SLOTS]??null;}
export function expandFormation(game,profile,padIndex){
  if(game.phase!=="prep")return{ok:false,reason:"布防阶段才能扩建。"};
  if(game.slot_count>=MAX_SLOTS)return{ok:false,reason:"扩建已满 8/8。"};
  if(game.expansion_used_wave===game.current_wave)return{ok:false,reason:"本波已扩建。"};
  if(!Number.isInteger(padIndex)||padIndex<0||padIndex>=PADS.length||game.pad_choices.includes(padIndex))return{ok:false,reason:"请选择一块未使用的空地。"};
  const cost=expansionCost(game);if(cost===null)return{ok:false,reason:"扩建已满 8/8。"};
  if(profile.premium<cost)return{ok:false,reason:"保费不足：扩建需要 "+cost+" 保费。"};
  const draft=clone(game),profileDraft=clone(profile);profileDraft.premium-=cost;draft.slot_count+=1;draft.pad_choices.push(padIndex);draft.expansion_used_wave=draft.current_wave;draft.formation.push(null);draft.selected=null;
  recordOperation(draft,"expand",null,{pad_index:padIndex});appendLog(draft,"扩建办公位（第"+draft.slot_count+"位），支出"+cost+"保费。");gameSaveInto(game,draft);Object.assign(profile,profileDraft);return{ok:true,cost,slotIndex:draft.slot_count-1};
}
export function equipmentAssignedCount(game,id){return game.formation.filter(t=>t&&t.equipment_id===id).length;}
export function equipTower(game,profile,index,equipmentId){
  if(game.phase!=="prep")return{ok:false,reason:"布防阶段才能更换装备。"};
  const tower=game.formation[index];if(!tower)return{ok:false,reason:"请选择一个已布置的办公位。"};
  if(equipmentId===null||equipmentId==="basic")return unequipTower(game,profile,index);
  if(!EQUIPMENT_IDS.includes(equipmentId))return{ok:false,reason:"装备无效。"};
  if((profile.equipment_owned?.[equipmentId]||0)<=0)return{ok:false,reason:"未持有该类装备。"};
  const assigned=equipmentAssignedCount(game,equipmentId);
  if(assigned>=(profile.equipment_owned[equipmentId]||0)&&tower.equipment_id!==equipmentId)return{ok:false,reason:"可用装备不足：先卸下其它塔上的同类装备。"};
  const draft=clone(game);draft.formation[index].equipment_id=equipmentId;draft.selected={area:"formation",index};recordOperation(draft,"equip",{area:"formation",index},null);appendLog(draft,"已装备"+equipmentLabel(equipmentId)+"。");gameSaveInto(game,draft);return{ok:true};
}
export function unequipTower(game,profile,index){
  if(game.phase!=="prep")return{ok:false,reason:"布防阶段才能更换装备。"};
  const tower=game.formation[index];if(!tower)return{ok:false,reason:"请选择一个已布置的办公位。"};
  if(!tower.equipment_id||tower.equipment_id==="basic")return{ok:false,reason:"该塔没有可卸下的装备。"};
  const draft=clone(game);draft.formation[index].equipment_id=EQUIPMENT_BY_TYPE[tower.type];recordOperation(draft,"unequip",{area:"formation",index},null);appendLog(draft,"已卸下"+equipmentLabel(tower.equipment_id)+"。");gameSaveInto(game,draft);return{ok:true};
}
function towerStats(spec,tower){
  let damage=spec.damage_by_level[tower.level-1],radius=spec.radius_cells,period=spec.attack_period_ms;
  const eq=TOWER_EQUIPMENT.get(tower.equipment_id);
  if(eq?.effect==="damage_multiplier")damage=Math.round(damage*eq.value);
  if(eq?.effect==="radius_multiplier")radius=radius*eq.value;
  if(eq?.effect==="attack_period_multiplier")period=Math.round(period*eq.value);
  return{damage,radius,period};
}
const TOWER_EQUIPMENT=new Map(CONFIG.equipment.types.map(t=>[t.id,t]));
export function towerEffectiveStats(tower){const spec=TOWER_BY_ID.get(tower.type);return towerStats(spec,tower);}
function isBossWave(wave){return WAVE_BY_ID.get(wave).spawns.some(s=>ENEMY_BY_ID.get(s.enemy)?.tier==="boss");}
function grantEquipment(game,profile,reason){
  if(game.equipment_dropped_run>=CONFIG.equipment.drop.max_per_run)return false;
  const pool=CONFIG.equipment.drop.pool,total=pool.reduce((s,x)=>s+x.weight,0);let roll=nextUint32(game)/4294967296*total,id=pool.at(-1).id;
  for(const item of pool){roll-=item.weight;if(roll<0){id=item.id;break;}}
  if((profile.equipment_owned[id]||0)>=CONFIG.equipment.inventory.per_type_cap){const credited=creditPremium(profile,game,CONFIG.equipment.drop.overflow_convert.amount);appendLog(game,CONFIG.equipment.drop.ui.full_text+"（+" +credited+" 保费）");}
  else{profile.equipment_owned[id]=(profile.equipment_owned[id]||0)+1;appendLog(game,CONFIG.equipment.drop.ui.toast_prefix+EQUIPMENT_LABEL[id]);}
  game.equipment_dropped_run+=1;game.equipment_pity=0;recordOperation(game,"equipment-drop",null,{id,reason});return true;
}
function rollEquipmentDrop(game,profile,wave){
  if(game.equipment_dropped_run>=CONFIG.equipment.drop.max_per_run)return;
  const boss=isBossWave(wave),chance=CONFIG.equipment.drop.normal_wave_chance;
  const guaranteed=boss||game.equipment_pity>=CONFIG.equipment.drop.pity_after-1;
  const rolled=!boss&&!guaranteed&&(nextUint32(game)/4294967296)<chance;
  if(guaranteed||rolled){if(grantEquipment(game,profile,boss?"boss":"wave"))appendLog(game,boss?CONFIG.equipment.drop.ui.boss_text:"守波掉落装备。");}
  else game.equipment_pity=Math.min(CONFIG.equipment.drop.pity_after-1,game.equipment_pity+1);
}
export function startWave(game){
  if(game.phase!=="prep")return false;if(!game.formation.some(Boolean))appendLog(game,"提示：当前没有部署险种。");
  game.selected=null;
  game.phase="combat";game.tick_index=0;game.elapsed_ms=0;game.wave_elapsed_ms=0;game.spawns_done=0;game.enemies=[];game.effects=[];game.visuals=[];
  game.wave_premium_earned=0;
  game.formation.forEach(tower=>{if(tower){tower.cooldown_ms=0;tower.stunned_until_ms=0;tower.protected_until_ms=0;}});recordOperation(game,"start-wave",null,null);return true;
}
function spawnEnemy(game,spawn){
  const spec=ENEMY_BY_ID.get(spawn.enemy),wave=WAVE_BY_ID.get(game.current_wave),hpMultiplier=wave.enemy_hp_multiplier||1;
  // 0.9c: bosses use hp_scaling="flat" (absolute HP, no wave multiplier); everything else keeps the wave multiplier.
  const spawnHp=Number.isInteger(spawn.hp_override)?Math.round(spawn.hp_override):spec.hp_scaling==="flat"?Math.round(spec.hp):Math.round(spec.hp*hpMultiplier);
  game.enemies.push({id:entityId(game),type:spawn.enemy,y:0,hp:spawnHp,max_hp:spawnHp,speed:spec.speed*(wave.enemy_speed_multiplier||1),slow_until_ms:0,root_until_ms:0,windup_ends_ms:0,target_id:null,cooldown_until_ms:0});
}
function removeDead(game){game.enemies=game.enemies.filter(enemy=>enemy.hp>0);}
function pushVisual(game,kind,data,durationMs){
  while(game.visuals.length>=CONFIG.presentation.visual_cap)game.visuals.shift();
  game.visuals.push({id:game.next_visual_id++,kind,...data,started_ms:game.elapsed_ms,expires_ms:game.elapsed_ms+durationMs});
}
function pushEffect(game,effect){
  while(game.effects.length>=CONFIG.presentation.effect_cap)game.effects.shift();
  game.effects.push(effect);
}
function creditPremium(profile,game,amount){const credited=Math.max(0,Math.min(amount,CONFIG.profile.premium_cap-profile.premium));profile.premium+=credited;game.diagnostics.premium_earned=(game.diagnostics.premium_earned||0)+credited;game.wave_premium_earned=(game.wave_premium_earned||0)+credited;return credited;}
function hitEnemy(game,profile,enemy,damage){
  if(enemy.hp<=0)return;enemy.hp=Math.max(0,enemy.hp-damage);game.diagnostics.attacks++;
  const pos=positionOnPath(enemy.y);
  pushVisual(game,"hit-flash",{x:pos.col,y:pos.row,enemy_id:enemy.id},CONFIG.presentation.flash_ms);
  pushVisual(game,"damage-float",{x:pos.col,y:pos.row,value:damage},CONFIG.presentation.damage_float_ms);
  if(enemy.hp===0){creditPremium(profile,game,1);game.diagnostics.kills++;appendLog(game,"来件完成老实续保，获得1保费。");pushVisual(game,"point-reward",{x:pos.col,y:pos.row,value:1},CONFIG.presentation.reward_float_ms);}
}
function applyAreaDamage(game,profile,effect,damage){
  const center={col:effect.x,row:effect.y};const hits=game.enemies.filter(enemy=>enemy.hp>0&&distance(positionOnPath(enemy.y),center)<=effect.radius_cells).sort((a,b)=>a.id.localeCompare(b.id));
  for(const enemy of hits){
    let actual=damage;
    if(effect.kind==="seal"&&effect.human_injury_multiplier){
      const spec=ENEMY_BY_ID.get(enemy.type);
      if(spec&&spec.human_injury)actual=Math.round(damage*effect.human_injury_multiplier);
    }
    hitEnemy(game,profile,enemy,actual);
    if(effect.kind==="construction")enemy.slow_until_ms=Math.max(enemy.slow_until_ms,game.elapsed_ms+effect.slow_duration_ms);
  }removeDead(game);
}
function processDueEffects(game,profile){
  const due=game.effects.filter(effect=>effect.due_ms<=game.elapsed_ms).sort((a,b)=>a.due_ms-b.due_ms||(a.kind==="fire-tick"?0:1)-(b.kind==="fire-tick"?0:1)||a.seq-b.seq);game.effects=game.effects.filter(effect=>effect.due_ms>game.elapsed_ms);
  for(const effect of due){
    if(effect.kind==="fire-tick"){
      pushVisual(game,"fire-pulse",{x:effect.x,y:effect.y},420);applyAreaDamage(game,profile,effect,effect.damage);effect.remaining_ticks--;
      if(effect.remaining_ticks>0&&effect.ends_ms>game.elapsed_ms){effect.due_ms+=effect.period_ms;effect.seq=game.next_event_seq++;pushEffect(game,effect);}
    }else if(effect.kind==="fire-create"){
      game.effects=game.effects.filter(item=>!(item.kind==="fire-tick"&&item.source_id===effect.source_id));
      pushEffect(game,{...effect,kind:"fire-tick",remaining_ticks:6,period_ms:500,due_ms:game.elapsed_ms+500,ends_ms:game.elapsed_ms+3000});pushVisual(game,"fire-zone",{x:effect.x,y:effect.y},3000);
    }else{
      const blastByKind={construction:"rock-impact",car:"car-blast",machine:"machine-blast",seal:"bandage-burst",wave:"wave-blast"};
      pushVisual(game,blastByKind[effect.kind]||"car-blast",{x:effect.x,y:effect.y},850);
      applyAreaDamage(game,profile,effect,effect.damage);
      if(effect.kind==="seal"&&effect.root_duration_ms>0){
        const center={col:effect.x,row:effect.y};
        for(const enemy of game.enemies){
          if(enemy.hp<=0)continue;
          if(distance(positionOnPath(enemy.y),center)<=effect.radius_cells)enemy.root_until_ms=Math.max(enemy.root_until_ms||0,Math.min(game.elapsed_ms+effect.root_duration_ms,game.elapsed_ms+1200));
        }
      }
    }
  }
}
function clearRoots(game){for(const enemy of game.enemies)enemy.root_until_ms=0;}
function stunTower(game,tower){if(game.elapsed_ms<tower.stunned_until_ms||game.elapsed_ms<tower.protected_until_ms)return;tower.stunned_until_ms=game.elapsed_ms+CONFIG.stun.duration_ms;tower.protected_until_ms=tower.stunned_until_ms+CONFIG.stun.immunity_after_recovery_ms;game.diagnostics.stuns++;appendLog(game,INSURANCES[tower.type].name+"受击，短暂眩晕。");}
function targetTower(game,enemy,spec){
  const enemyPos=positionOnPath(enemy.y);
  return game.formation.map((tower,index)=>({tower,index,distance:distance(enemyPos,posForOffice(index,game))})).filter(item=>item.tower&&item.distance<=spec.attack_range_cells).sort((a,b)=>a.distance-b.distance||a.index-b.index)[0]||null;
}
function updateEnemies(game,profile){
  for(const enemy of [...game.enemies].sort((a,b)=>a.id.localeCompare(b.id))){
    if(enemy.hp<=0)continue;const spec=ENEMY_BY_ID.get(enemy.type);
    if(enemy.windup_ends_ms>0){if(game.elapsed_ms>=enemy.windup_ends_ms){const target=game.formation.find(tower=>tower&&tower.id===enemy.target_id);if(target)stunTower(game,target);enemy.cooldown_until_ms=game.elapsed_ms+spec.attack_cooldown_ms;enemy.windup_ends_ms=0;enemy.target_id=null;}else continue;}
    if(enemy.y>=100000){if(leakEnemy(game,enemy,spec)){removeDead(game);return;}continue;}
    // liability intercept: no movement and no new windup while rooted; an in-flight windup above still resolves.
    if(game.elapsed_ms<(enemy.root_until_ms||0))continue;
    if(game.elapsed_ms>=enemy.cooldown_until_ms){const target=targetTower(game,enemy,spec);if(target){enemy.windup_ends_ms=game.elapsed_ms+spec.attack_windup_ms;enemy.target_id=target.tower.id;continue;}}
    const slow=game.elapsed_ms<enemy.slow_until_ms?0.4:1;enemy.y=Math.min(100000,enemy.y+Math.round((enemy.speed||spec.speed)*50*slow));
    if(enemy.y>=100000&&leakEnemy(game,enemy,spec)){removeDead(game);return;}
  }removeDead(game);
}
function towerAttack(game,tower,officeIndex){
  const spec=TOWER_BY_ID.get(tower.type),origin=posForOffice(officeIndex,game),mods=towerStats(spec,tower);
  const target=game.enemies.filter(enemy=>enemy.hp>0).map(enemy=>({enemy,pos:positionOnPath(enemy.y)})).filter(item=>distance(origin,item.pos)<=mods.radius).sort((a,b)=>a.enemy.y-b.enemy.y||a.enemy.id.localeCompare(b.enemy.id))[0];
  if(!target)return;const delay=spec.impact_delay_ms,targetPos=target.pos;
  const base={x:targetPos.col,y:targetPos.row,radius_cells:mods.radius,source_id:tower.id,damage:mods.damage,seq:game.next_event_seq++};
  const shotByEffect={exploding_car:"car-shot",slope_impact:"rock-shot",fire_zone:"flame-shot",overload:"machine-shot",intercept:"seal-shot",tidal_wave:"wave-shot"};
  pushVisual(game,shotByEffect[spec.effect]||"car-shot",{from_x:origin.col,from_y:origin.row,to_x:targetPos.col,to_y:targetPos.row,x:targetPos.col,y:targetPos.row},Math.max(delay+260,520));
  if(spec.effect==="fire_zone")pushEffect(game,{...base,kind:"fire-create",due_ms:game.elapsed_ms+delay,remaining_ticks:0});
  else{
    const kindByEffect={exploding_car:"car",slope_impact:"construction",overload:"machine",intercept:"seal",tidal_wave:"wave"};
    pushEffect(game,{...base,kind:kindByEffect[spec.effect]||"car",due_ms:game.elapsed_ms+delay,slow_duration_ms:spec.slow_duration_ms||0,root_duration_ms:spec.root_duration_ms||0,human_injury_multiplier:spec.human_injury_multiplier||0});
  }
  tower.cooldown_ms=mods.period;game.diagnostics.attacks++;
}
function updateTowers(game){for(let index=0;index<game.formation.length;index++){
  const tower=game.formation[index];if(!tower||game.elapsed_ms<tower.stunned_until_ms)continue;
  if(tower.cooldown_ms>0)tower.cooldown_ms=Math.max(0,tower.cooldown_ms-CONFIG.simulation.tick_ms);
  if(tower.cooldown_ms===0)towerAttack(game,tower,index);
}}
function leakEnemy(game,enemy,spec){
  const protectedNow=game.elapsed_ms<game.inspector_protected_until_ms;game.diagnostics.leaks++;
  if(protectedNow){enemy.hp=0;appendLog(game,enemyDisplayName(spec)+"漏过防线，不属责保护生效，未扣耐久。");return false;}
  const pos=positionOnPath(enemy.y);pushVisual(game,"leak-flash",{x:pos.col,y:pos.row},CONFIG.presentation.leak_flash_ms);
  game.core_hp=Math.max(0,game.core_hp-spec.leak_damage);enemy.hp=0;
  appendLog(game,enemyDisplayName(spec)+"漏过防线，查勘员耐久-"+spec.leak_damage+"。");
  if(game.core_hp<=0){game.phase="defeat";game.settlement=settlementFor(game);game.effects=[];game.visuals=[];game.inspector_protected_until_ms=0;clearRoots(game);appendLog(game,"查勘员耐久耗尽。");return true;}return false;
}
function finishWave(game,profile,run){
  if(game.phase!=="combat")return;const wave=game.current_wave;if(game.core_hp<=0){game.phase="defeat";game.settlement=settlementFor(game);game.effects=[];game.visuals=[];game.inspector_protected_until_ms=0;clearRoots(game);run.status="terminal";run.closed_run_seq=run.run_seq;return;}
  const script=WAVE_BY_ID.get(wave).spawns;if(game.spawns_done<script.length||game.enemies.length>0)return;game.effects=[];game.visuals=[];
  if(!game.cleared_wave_ids.includes(wave)){
    game.cleared_wave_ids.push(wave);
    const credited=creditPremium(profile,game,CONFIG.economy.wave_clear_reward);
    appendLog(game,"第"+wave+"波守住，获得"+credited+"保费。");
    const rebate=creditRebate(game,profile);
    if(rebate>0)appendLog(game,"本波返利 +"+rebate+"。");
    rollEquipmentDrop(game,profile,wave);
    // Counters belong to the wave just settled; reset before the next prep so new spending starts from 0.
    game.wave_premium_earned=0;game.wave_premium_spent=0;
  }
  recordOperation(game,"wave-clear",null,null);
  if(wave>=CONFIG.waves.length){const bonus=CONFIG.equipment.drop.settlement_bonus;if(game.equipment_dropped_run<bonus.if_run_dropped_less_than)grantEquipment(game,profile,"victory_bonus");game.phase="victory";game.settlement=settlementFor(game);run.status="terminal";run.closed_run_seq=run.run_seq;appendLog(game,"十波完成，案件结案。");}
  else{game.current_wave=wave+1;game.phase="prep";game.inspector_protected_until_ms=0;game.free_refresh_left=CONFIG.economy.free_refresh_per_prep;game.formation.forEach(t=>{if(t){t.cooldown_ms=0;t.stunned_until_ms=0;t.protected_until_ms=0;}});}
}
function validateItemUse(game,profile,run,itemId){
  if(game.phase!=="combat"||run.status!=="active")return{ok:false,reason:"道具只能在战斗中使用。"};if(!INVENTORY_IDS.includes(itemId))return{ok:false,reason:"道具无效。"};if(profile.inventory[itemId]<=0)return{ok:false,reason:"没有这件道具库存。"};if(run.items_used[itemId]>=1)return{ok:false,reason:"本局已使用过这件道具。"};
  const enemies=game.enemies.filter(enemy=>enemy.hp>0);if(itemId==="zero_settlement"&&!enemies.length)return{ok:false,reason:"场上没有可结清的来件。"};if(itemId==="deny_claim"&&!enemies.some(enemy=>enemy.y>0||enemy.windup_ends_ms>game.elapsed_ms))return{ok:false,reason:"没有可退回或取消攻击的来件。"};if(itemId==="outside_liability"&&(game.core_hp<=0||game.elapsed_ms<game.inspector_protected_until_ms))return{ok:false,reason:"当前无法再次启用不属责。"};return{ok:true};
}
function applyItem(game,profile,run,itemId){
  const check=validateItemUse(game,profile,run,itemId);if(!check.ok)return check;profile.inventory[itemId]--;run.items_used[itemId]=1;const effect=CONFIG.items[itemId];
  if(itemId==="zero_settlement"){
    const active=game.enemies.filter(enemy=>enemy.hp>0).sort((a,b)=>a.id.localeCompare(b.id));for(const enemy of active){const pos=positionOnPath(enemy.y);creditPremium(profile,game,1);game.diagnostics.kills++;appendLog(game,"来件完成老实续保，获得1保费。");pushVisual(game,"point-reward",{x:pos.col,y:pos.row,value:1},CONFIG.presentation.reward_float_ms);}game.enemies=game.enemies.filter(enemy=>enemy.hp<=0);pushVisual(game,"item-zero",{x:4,y:4},effect.duration_ms);
  }else if(itemId==="deny_claim"){
    for(const enemy of game.enemies){if(enemy.hp<=0)continue;enemy.y=0;enemy.windup_ends_ms=0;enemy.target_id=null;}pushVisual(game,"item-reject",{x:7.5,y:.5},effect.duration_ms);
  }else{game.inspector_protected_until_ms=game.elapsed_ms+effect.duration_ms;pushVisual(game,"item-shield",{x:CONFIG.board.inspector_position[0]+.5,y:CONFIG.board.inspector_position[1]+.5},effect.duration_ms);}
  appendLog(game,"已使用"+effect.name+"。");return{ok:true,itemId};
}
export function tick(game,profile,run,itemId=null){
  if(game.phase!=="combat")return{ok:false,reason:"当前不在战斗阶段。"};game.tick_index++;game.elapsed_ms=game.tick_index*CONFIG.simulation.tick_ms;game.wave_elapsed_ms+=CONFIG.simulation.tick_ms;
  const script=WAVE_BY_ID.get(game.current_wave).spawns;while(game.spawns_done<script.length&&script[game.spawns_done].at_ms<=game.wave_elapsed_ms)spawnEnemy(game,script[game.spawns_done++]);
  let used=null;if(itemId){const result=applyItem(game,profile,run,itemId);if(!result.ok)return result;used=itemId;if(itemId==="zero_settlement"&&game.spawns_done===script.length&&game.enemies.length===0){finishWave(game,profile,run);return{ok:true,used,waveEnded:true};}}
  processDueEffects(game,profile);updateEnemies(game,profile);if(game.phase==="defeat"){game.effects=[];game.visuals=[];game.inspector_protected_until_ms=0;run.status="terminal";run.closed_run_seq=run.run_seq;return{ok:true,used};}updateTowers(game);game.visuals=game.visuals.filter(visual=>visual.expires_ms>game.elapsed_ms);finishWave(game,profile,run);return{ok:true,used};
}

function validateGameShape(game,{schemaVersion,configVersion,maxWave,settlementMode}){
  const v10=settlementMode==="v10";
  const modern=settlementMode==="v08"||settlementMode==="v09"||v10;
  const rootMode=settlementMode==="v09"||v10;
  if(!game||game.schema_version!==schemaVersion||game.config_version!==configVersion||!['prep','combat','paused','victory','defeat'].includes(game.phase)||Object.hasOwn(game,"points")||game.wave_start_snapshot!=null)return false;
  if(!Number.isInteger(game.current_wave)||game.current_wave<1||game.current_wave>maxWave||!Number.isInteger(game.rng_state)||game.rng_state===0)return false;
  if(!Number.isInteger(game.next_entity_id)||game.next_entity_id<1||!Number.isInteger(game.free_refresh_left)||game.free_refresh_left<0||game.free_refresh_left>CONFIG.economy.free_refresh_per_prep)return false;
  if(!Number.isSafeInteger(game.tick_index)||game.tick_index<0||game.tick_index>10000000||!Number.isSafeInteger(game.elapsed_ms)||game.elapsed_ms<0||game.elapsed_ms!==game.tick_index*CONFIG.simulation.tick_ms)return false;
  if(!Number.isSafeInteger(game.wave_elapsed_ms)||game.wave_elapsed_ms<0||game.wave_elapsed_ms>game.elapsed_ms||!Number.isInteger(game.spawns_done)||game.spawns_done<0||game.spawns_done>100000)return false;
  if(!Array.isArray(game.hand)||game.hand.length!==CONFIG.economy.hand_capacity||!Array.isArray(game.formation)||!Array.isArray(game.offers)||game.offers.length!==CONFIG.economy.offer_count)return false;
  const slotOk=v10?Number.isInteger(game.slot_count)&&game.slot_count>=FIXED_SLOTS&&game.slot_count<=MAX_SLOTS&&game.formation.length===game.slot_count:game.formation.length===FIXED_SLOTS;
  if(!slotOk)return false;
  if(v10){
    if(!Array.isArray(game.pad_choices)||game.pad_choices.length!==game.slot_count-FIXED_SLOTS||new Set(game.pad_choices).size!==game.pad_choices.length||!game.pad_choices.every(i=>Number.isInteger(i)&&i>=0&&i<PADS.length))return false;
    if(!Number.isInteger(game.expansion_used_wave)||game.expansion_used_wave<0||game.expansion_used_wave>game.current_wave)return false;
    if(!Number.isInteger(game.equipment_pity)||game.equipment_pity<0||game.equipment_pity>CONFIG.equipment.drop.pity_after)return false;
    if(!Number.isInteger(game.equipment_dropped_run)||game.equipment_dropped_run<0||game.equipment_dropped_run>CONFIG.equipment.drop.max_per_run)return false;
  }
  if(!Number.isInteger(game.core_hp)||game.core_hp<0||game.core_hp>CONFIG.formation.base_hp||!Number.isSafeInteger(game.inspector_protected_until_ms)||game.inspector_protected_until_ms<0||game.inspector_protected_until_ms>game.elapsed_ms+CONFIG.items.outside_liability.duration_ms||!Array.isArray(game.enemies)||!Array.isArray(game.effects)||!Array.isArray(game.visuals)||!Array.isArray(game.cleared_wave_ids))return false;
  if(game.phase!=="combat"&&game.phase!=="paused"&&game.inspector_protected_until_ms!==0)return false;
  const cards=[...game.hand,...game.formation].filter(Boolean),entities=cards.concat(game.offers,game.enemies),ids=entities.map(entity=>entity.id);if(new Set(ids).size!==ids.length||!entities.every(entity=>typeof entity.id==="string"&&/^e[0-9]{8,}$/.test(entity.id)))return false;
  const highestId=entities.reduce((highest,entity)=>Math.max(highest,Number(entity.id.slice(1))),0);if(game.next_entity_id<=highestId)return false;
  const refundCaps=CONFIG.salvage.refund_cap_by_level;
  if(!cards.every(card=>TOWER_BY_ID.has(card.type)&&Number.isInteger(card.level)&&card.level>=1&&card.level<=CONFIG.economy.max_level&&(!v10||card.equipment_id===null||card.equipment_id==="basic"||EQUIPMENT_IDS.includes(card.equipment_id))&&Number.isSafeInteger(card.salvage_credit)&&card.salvage_credit>=0&&card.salvage_credit<=refundCaps[card.level-1]))return false;
  if(!game.offers.every(card=>card&&card.level===1&&CONFIG.economy.offer_pool.includes(card.type)))return false;
  if(!game.enemies.every(enemy=>ENEMY_BY_ID.has(enemy.type)&&Number.isInteger(enemy.y)&&enemy.y>=0&&enemy.y<=100000&&Number.isSafeInteger(enemy.max_hp)&&enemy.max_hp>0&&Number.isSafeInteger(enemy.hp)&&enemy.hp>=0&&enemy.hp<=enemy.max_hp&&Number.isFinite(enemy.speed)&&enemy.speed>0&&Number.isSafeInteger(enemy.windup_ends_ms)&&enemy.windup_ends_ms>=0&&Number.isSafeInteger(enemy.cooldown_until_ms)&&enemy.cooldown_until_ms>=0))return false;
  if(rootMode){
    if(!game.enemies.every(enemy=>Number.isSafeInteger(enemy.root_until_ms)&&enemy.root_until_ms>=0&&enemy.root_until_ms<=game.elapsed_ms+1200))return false;
    if(game.phase!=="combat"&&game.phase!=="paused"&&game.enemies.some(enemy=>enemy.root_until_ms!==0))return false;
  }
  const diagnosticKeys=modern?DIAGNOSTIC_KEYS_08:DIAGNOSTIC_KEYS;
  if(!game.diagnostics||!diagnosticKeys.every(key=>Number.isSafeInteger(game.diagnostics[key])&&game.diagnostics[key]>=0))return false;
  if(modern){
    if(!Number.isSafeInteger(game.wave_premium_earned)||game.wave_premium_earned<0||game.wave_premium_earned>CONFIG.profile.premium_cap)return false;
    if(!Number.isSafeInteger(game.wave_premium_spent)||game.wave_premium_spent<0||game.wave_premium_spent>CONFIG.profile.premium_cap)return false;
  }
  if(!game.cleared_wave_ids.every(id=>Number.isInteger(id)&&id>=1&&id<=maxWave)||new Set(game.cleared_wave_ids).size!==game.cleared_wave_ids.length)return false;
  const terminal=game.phase==="victory"||game.phase==="defeat";
  if(modern||settlementMode==="v07"){
    if(!terminal){if(game.settlement!==null)return false;}
    else{
      const s=game.settlement;if(!s||typeof s!=="object"||!Number.isInteger(s.wave)||s.wave<1||s.wave>CONFIG.waves.length||s.result!==game.phase||!s.stats||typeof s.stats!=="object")return false;
      const stats=s.stats;const statKeys=v10?["kills","leaks","waves_cleared","premium_earned","rebate_earned","equipment_dropped"]:modern?["kills","leaks","waves_cleared","premium_earned","rebate_earned"]:["kills","leaks","waves_cleared","premium_earned"];
      if(!statKeys.every(key=>Number.isSafeInteger(stats[key])&&stats[key]>=0))return false;
      if(stats.kills!==game.diagnostics.kills||stats.leaks!==game.diagnostics.leaks||stats.waves_cleared!==game.cleared_wave_ids.length||stats.premium_earned!==game.diagnostics.premium_earned)return false;
      if(modern&&stats.rebate_earned!==game.diagnostics.rebate_earned)return false;
      if(v10&&stats.equipment_dropped!==game.equipment_dropped_run)return false;
      if(game.phase==="victory"){if(game.core_hp<1||game.core_hp>CONFIG.formation.base_hp)return false;if(s.rating!==ratingFor(game.core_hp))return false;}
      else{if(game.core_hp!==0||s.rating!==null)return false;}
    }
  }else if(settlementMode==="v06"){
    if(!terminal){if(game.settlement!=null&&game.settlement!==undefined)return false;}
    else{const s=game.settlement;if(!s||typeof s!=="object"||!Number.isInteger(s.wave)||s.wave<1||s.wave>maxWave||s.result!==game.phase)return false;if(game.phase==="victory"&&game.core_hp<1)return false;if(game.phase==="defeat"&&game.core_hp!==0)return false;}
  }
  return true;
}
export function validateGame(game){return validateGameShape(game,{schemaVersion:CONFIG.schema_version,configVersion:CONFIG.config_version,maxWave:CONFIG.waves.length,settlementMode:"v10"});}
export function validateEnvelope(envelope){
  if(!envelope||envelope.format_id!==PROFILE_FORMAT||envelope.envelope_schema_version!==CONFIG.persistence.envelope_schema_version||envelope.config_version!==CONFIG.config_version||!Number.isSafeInteger(envelope.revision)||envelope.revision<0||!envelope.profile||!envelope.run||!validateGame(envelope.game))return false;
  const p=envelope.profile,r=envelope.run;
  if(typeof p.profile_id!=="string"||!p.profile_id||p.first_grant_applied!==true||typeof p.teaching_done!=="boolean")return false;
  if(!Number.isSafeInteger(p.teaching_stage)||p.teaching_stage<0||p.teaching_stage>CONFIG.teaching.stages_total)return false;
  if(!Number.isSafeInteger(p.premium)||p.premium<0||p.premium>CONFIG.profile.premium_cap)return false;
  if(!Number.isSafeInteger(p.rebate)||p.rebate<0||p.rebate>CONFIG.profile.rebate_cap)return false;
  if(!p.inventory||!p.receipts||!Array.isArray(p.receipts)||p.receipts.length>CONFIG.profile.receipt_limit||!Number.isSafeInteger(p.action_seq)||p.action_seq<0)return false;
  if(!p.equipment_owned||!EQUIPMENT_IDS.every(id=>Number.isInteger(p.equipment_owned[id])&&p.equipment_owned[id]>=0&&p.equipment_owned[id]<=CONFIG.equipment.inventory.per_type_cap)||Object.keys(p.equipment_owned).length!==EQUIPMENT_IDS.length)return false;
  const assigned=Object.fromEntries(EQUIPMENT_IDS.map(id=>[id,0]));for(const tower of envelope.game.formation.filter(Boolean)){if(EQUIPMENT_IDS.includes(tower.equipment_id))assigned[tower.equipment_id]++;}
  if(EQUIPMENT_IDS.some(id=>assigned[id]>p.equipment_owned[id]))return false;
  if(p.import_source!==null){const s=p.import_source;if(typeof s!=="object"||typeof s.key!=="string"||typeof s.config_version!=="string"||!Number.isSafeInteger(s.game_schema_version)||!Number.isSafeInteger(s.raw_length)||s.raw_length<0||typeof s.fnv1a32!=="string"||!s.fnv1a32||typeof s.imported_at!=="string")return false;}
  if(INVENTORY_IDS.some(id=>!Number.isInteger(p.inventory[id])||p.inventory[id]<0||p.inventory[id]>CONFIG.profile.inventory_cap_per_item)||Object.keys(p.inventory).length!==INVENTORY_IDS.length)return false;
  if(typeof r.run_id!=="string"||!Number.isSafeInteger(r.run_seq)||r.run_seq<1||r.run_id!==p.profile_id+":run:"+r.run_seq||!Number.isSafeInteger(r.closed_run_seq)||r.closed_run_seq<0||r.closed_run_seq>r.run_seq||!['active','terminal'].includes(r.status)||!r.items_used)return false;
  if(INVENTORY_IDS.some(id=>!Number.isInteger(r.items_used[id])||r.items_used[id]<0||r.items_used[id]>1)||Object.keys(r.items_used).length!==INVENTORY_IDS.length)return false;
  if((envelope.game.phase==="victory"||envelope.game.phase==="defeat")!==(r.status==="terminal"))return false;
  if(r.status==="terminal"&&r.closed_run_seq!==r.run_seq)return false;if(r.status==="active"&&r.closed_run_seq!==r.run_seq-1)return false;
  const receiptIds=new Set;for(const receipt of p.receipts){if(!receipt||typeof receipt.action_id!=="string"||!receipt.action_id.startsWith(p.profile_id+":")||typeof receipt.type!=="string"||!receipt.type||!receipt.details||typeof receipt.details!=="object"||!Number.isSafeInteger(receipt.revision)||receipt.revision<1||receipt.revision>envelope.revision||typeof receipt.run_id!=="string"||receiptIds.has(receipt.action_id))return false;const seq=Number(receipt.action_id.slice(receipt.action_id.lastIndexOf(":")+1));if(!Number.isSafeInteger(seq)||seq<1||seq>p.action_seq)return false;receiptIds.add(receipt.action_id);}return true;
}
export function commitEnvelope(expected,candidate,storage=globalThis.localStorage){
  if(!storage)return{ok:false,kind:"unavailable",reason:"本地存储不可用。"};const key=PROFILE_KEY;let beforeRaw;
  try{beforeRaw=storage.getItem(key);}catch{return{ok:false,kind:"unknown",reason:"正在核对保存结果。"};}
  let current=null;if(beforeRaw!==null){try{current=JSON.parse(beforeRaw);}catch{return{ok:false,kind:"conflict",reason:"保存档案无法读取，已停止写入。"};}if(!validateEnvelope(current))return{ok:false,kind:"conflict",reason:"保存档案损坏，已停止写入。"};}
  if(expected===null?current!==null:!current||current.revision!==expected.revision||current.profile.profile_id!==expected.profile.profile_id)return{ok:false,kind:"conflict",reason:"档案版本已变化，请重新核对。"};
  const next=clone(candidate);next.revision=(expected?.revision||0)+1;if(!validateEnvelope(next))return{ok:false,kind:"invalid",reason:"新案卷校验失败，未保存。"};const serialized=JSON.stringify(next);
  try{storage.setItem(key,serialized);const readback=storage.getItem(key);if(readback===serialized)return{ok:true,envelope:next};if(readback===beforeRaw)return{ok:false,kind:"not_written",reason:"未保存成功，本次操作未完成。"};return{ok:false,kind:"unknown",reason:"正在核对保存结果。"};}
  catch{try{const readback=storage.getItem(key);if(readback===serialized)return{ok:true,envelope:next};if(readback===beforeRaw)return{ok:false,kind:"not_written",reason:"未保存成功，本次操作未完成。"};}catch{}return{ok:false,kind:"unknown",reason:"正在核对保存结果。"};}
}
function fingerprint(raw){let x=2166136261;for(let i=0;i<raw.length;i++)x=Math.imul(x^raw.charCodeAt(i),16777619)>>>0;return"fnv1a32:"+x.toString(16).padStart(8,"0");}
function settleImportGame(game,{fromVersion}){
  game.schema_version=CONFIG.schema_version;game.config_version=CONFIG.config_version;game.selected=null;
  game.diagnostics=game.diagnostics||{};
  if(!Number.isSafeInteger(game.diagnostics.rebate_earned)||fromVersion!=="INS-MVP-0.8")game.diagnostics.rebate_earned=0;
  game.wave_premium_earned=0;game.wave_premium_spent=0;
  game.slot_count=FIXED_SLOTS;game.pad_choices=[];game.expansion_used_wave=0;game.equipment_pity=0;game.equipment_dropped_run=0;
  if(!Array.isArray(game.formation))game.formation=Array(FIXED_SLOTS).fill(null);while(game.formation.length<FIXED_SLOTS)game.formation.push(null);
  for(const enemy of game.enemies||[])enemy.root_until_ms=0;
  if(game.phase==="combat"||game.phase==="paused")game.phase="paused";
  game.settlement=(game.phase==="victory"||game.phase==="defeat")?settlementFor(game):null;
  if(game.settlement)game.settlement.stats.equipment_dropped=0;
  return game;
}
function validateEnvelopeBase(envelope,{format,envelopeVersion,gameSchema,configVersion,maxWaves,settlementMode}){
  if(!envelope||envelope.format_id!==format||envelope.envelope_schema_version!==envelopeVersion||envelope.config_version!==configVersion||!Number.isSafeInteger(envelope.revision)||envelope.revision<0||!envelope.profile||!envelope.run)return false;
  const p=envelope.profile,r=envelope.run;
  if(typeof p.profile_id!=="string"||!p.profile_id||p.first_grant_applied!==true||!Number.isSafeInteger(p.premium)||p.premium<0||p.premium>CONFIG.profile.premium_cap||!p.inventory||!Array.isArray(p.receipts)||p.receipts.length>CONFIG.profile.receipt_limit||!Number.isSafeInteger(p.action_seq)||p.action_seq<0)return false;
  if(INVENTORY_IDS.some(id=>!Number.isInteger(p.inventory[id])||p.inventory[id]<0||p.inventory[id]>CONFIG.profile.inventory_cap_per_item)||Object.keys(p.inventory).length!==INVENTORY_IDS.length)return false;
  if(typeof r.run_id!=="string"||!Number.isSafeInteger(r.run_seq)||r.run_seq<1||r.run_id!==p.profile_id+":run:"+r.run_seq||!Number.isSafeInteger(r.closed_run_seq)||r.closed_run_seq<0||r.closed_run_seq>r.run_seq||!['active','terminal'].includes(r.status)||!r.items_used)return false;
  if(INVENTORY_IDS.some(id=>!Number.isInteger(r.items_used[id])||r.items_used[id]<0||r.items_used[id]>1)||Object.keys(r.items_used).length!==INVENTORY_IDS.length)return false;
  if(!validateGameShape(envelope.game,{schemaVersion:gameSchema,configVersion,maxWave:maxWaves,settlementMode}))return false;
  if((envelope.game.phase==="victory"||envelope.game.phase==="defeat")!==(r.status==="terminal"))return false;
  if(r.status==="terminal"&&r.closed_run_seq!==r.run_seq)return false;if(r.status==="active"&&r.closed_run_seq!==r.run_seq-1)return false;
  return true;
}
export function validateImport09Envelope(envelope){return validateEnvelopeBase(envelope,{format:"insurance-profile-0.9",envelopeVersion:4,gameSchema:6,configVersion:"INS-MVP-0.9",maxWaves:5,settlementMode:"v09"});}
export function validateImport08Envelope(envelope){return validateEnvelopeBase(envelope,{format:"insurance-profile-0.8",envelopeVersion:3,gameSchema:5,configVersion:"INS-MVP-0.8",maxWaves:5,settlementMode:"v08"});}
export function validateImport07Envelope(envelope){return validateEnvelopeBase(envelope,{format:"insurance-profile-0.7",envelopeVersion:2,gameSchema:4,configVersion:"INS-MVP-0.7",maxWaves:5,settlementMode:"v07"});}
export function validateImport06Envelope(envelope){return validateEnvelopeBase(envelope,{format:"insurance-profile-0.5",envelopeVersion:1,gameSchema:3,configVersion:"INS-UI-0.5",maxWaves:3,settlementMode:"v06"});}
function migrateTo10(envelope,source,fromVersion,now){
  const raw=typeof source?.raw==="string"?source.raw:JSON.stringify(envelope);
  const game=clone(envelope.game);settleImportGame(game,{fromVersion});
  const fromSchema=fromVersion==="INS-MVP-0.9"?6:fromVersion==="INS-MVP-0.8"?5:fromVersion==="INS-MVP-0.7"?4:3;
  const rebate=fromVersion==="INS-MVP-0.8"?(envelope.profile.rebate||0):(envelope.profile.rebate||0);
  const migrated={format_id:PROFILE_FORMAT,envelope_schema_version:CONFIG.persistence.envelope_schema_version,config_version:CONFIG.config_version,revision:0,profile:{profile_id:envelope.profile.profile_id,premium:envelope.profile.premium,rebate,inventory:clone(envelope.profile.inventory),equipment_owned:{reinforce:0,aim:0,rush:0},first_grant_applied:true,teaching_done:true,teaching_stage:CONFIG.teaching.stages_total,import_source:{key:source?.key||"",config_version:fromVersion,game_schema_version:fromSchema,raw_length:raw.length,fnv1a32:fingerprint(raw),imported_at:now},action_seq:envelope.profile.action_seq,receipts:[]},run:clone(envelope.run),game};
  if(!validateEnvelope(migrated))return{ok:false,reason:"迁移后的案卷校验失败，未写入。"};
  return{ok:true,envelope:migrated};
}
export function migrateFrom09(envelope,source,now=new Date().toISOString()){if(!validateImport09Envelope(envelope))return{ok:false,reason:"旧案卷校验未通过，未迁移。"};return migrateTo10(envelope,source,"INS-MVP-0.9",now);}
export function migrateFrom08(envelope,source,now=new Date().toISOString()){if(!validateImport08Envelope(envelope))return{ok:false,reason:"旧案卷校验未通过，未迁移。"};return migrateTo10(envelope,source,"INS-MVP-0.8",now);}
export function migrateFrom07(envelope,source,now=new Date().toISOString()){if(!validateImport07Envelope(envelope))return{ok:false,reason:"旧案卷校验未通过，未迁移。"};return migrateTo10(envelope,source,"INS-MVP-0.7",now);}
export function migrateFrom06(envelope,source,now=new Date().toISOString()){if(!validateImport06Envelope(envelope))return{ok:false,reason:"旧案卷校验未通过，未迁移。"};return migrateTo10(envelope,source,"INS-UI-0.5",now);}
export function loadProfile(storage=globalThis.localStorage){
  if(!storage)return{kind:"unavailable",reason:"本地保存不可用。"};
  let nativeRaw;try{nativeRaw=storage.getItem(PROFILE_KEY);}catch{return{kind:"unavailable",reason:"无法读取保存档案。"};}
  if(nativeRaw!==null){
    try{const envelope=JSON.parse(nativeRaw);return validateEnvelope(envelope)?{kind:"native",envelope}:{kind:"corrupt",reason:"保存档案损坏或版本不兼容，已保留原档。"};}
    catch{return{kind:"corrupt",reason:"保存档案无法读取，已保留原档。"};}
  }
  for(const source of IMPORT_SOURCES){
    let raw;try{raw=storage.getItem(source.key);}catch{return{kind:"unavailable",reason:"无法读取旧案卷。"};}
    if(raw===null)continue;
    const format=source.format_id,kind=format==="insurance-profile-0.9"?"import09":format==="insurance-profile-0.8"?"import08":format==="insurance-profile-0.7"?"import07":"import06",corruptKind="corrupt_"+kind;
    try{
      const envelope=JSON.parse(raw);
      const valid=kind==="import09"?validateImport09Envelope(envelope):kind==="import08"?validateImport08Envelope(envelope):kind==="import07"?validateImport07Envelope(envelope):validateImport06Envelope(envelope);
      if(!valid)return{kind:corruptKind,reason:"旧案卷无法读取；原档已保留，可选择临时试玩。"};
      return{kind,envelope,raw,source};
    }catch{return{kind:corruptKind,reason:"旧案卷无法读取；原档已保留，可选择临时试玩。"};}
  }
  return{kind:"empty"};
}
export function pauseRecoveredCombat(envelope){
  if(!validateEnvelope(envelope))return{ok:false,reason:"案卷无效，无法恢复。"};const draft=clone(envelope);if(draft.game.phase!=="combat")return{ok:true,envelope:draft,changed:false};draft.game.phase="paused";if(!validateEnvelope(draft))return{ok:false,reason:"暂停恢复校验失败。"};return{ok:true,envelope:draft,changed:true};
}
