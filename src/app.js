
const DEFAULT_COMPONENTS = [
  {id:'mid', name:'중간고사', weight:30, cuts:[75.93,63.58,49.13,34.53,16.81]},
  {id:'final', name:'기말고사', weight:30, cuts:[81.02,67.02,51.5,33.78,14.19]},
  {id:'p1', name:'수행평가1', weight:20, cuts:[95,90,80,70,30]},
  {id:'p2', name:'수행평가2', weight:20, cuts:[92,90,80,70,30]},
];
const DEFAULT_CONFIG = {mid:true, final:true, perf:2};
const MAX_PERF = 8;
const GRADES = ['A','B','C','D','E','미도달'];
const STORAGE_KEY = 'splitScoreCalc_components_v1';
const BANK_KEY = 'splitScoreCalc_bank_v2';
const CONFIG_KEY = 'splitScoreCalc_config_v2';

function defaultComp(id){
  const d = DEFAULT_COMPONENTS.find(c => c.id === id);
  return d ? JSON.parse(JSON.stringify(d)) : {id, name:'수행평가'+id.slice(1), weight:0, cuts:[0,0,0,0,0]};
}
function loadBank(){
  try {
    const raw = JSON.parse(localStorage.getItem(BANK_KEY) || 'null');
    if(raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
    const old = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if(Array.isArray(old) && old.length === 4) return Object.fromEntries(old.map((c,i)=>[['mid','final','p1','p2'][i],c]));
  } catch(e) {}
  return {};
}
function loadConfig(){
  try {
    const c = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    if(c && typeof c.mid === 'boolean' && typeof c.final === 'boolean' && Number.isInteger(c.perf) && c.perf >= 0 && c.perf <= MAX_PERF && (c.mid || c.final || c.perf)) return c;
  } catch(e) {}
  return {...DEFAULT_CONFIG};
}
function saveComponentsToStorage(){
  try {
    localStorage.setItem(BANK_KEY, JSON.stringify(BANK));
    localStorage.setItem(CONFIG_KEY, JSON.stringify(CONFIG));
  } catch(e) {}
}
function slotIds(cfg){
  return [...(cfg.mid?['mid']:[]), ...(cfg.final?['final']:[]), ...Array.from({length:cfg.perf},(_,i)=>'p'+(i+1))];
}
let BANK = loadBank();
let CONFIG = loadConfig();
let COMPONENTS = [];
let finalCuts = [null,null,null,null,null];
let configErrors = [];
let rawRows = [], lastMerges = [], lastStudents = [], skippedRows = [];
let anchorRow = 0, dataStartRow = 1;
let currentWorkbook = null, fileReadToken = 0;
window.__lastRows = [];

function rebuildComponents(){
  COMPONENTS = slotIds(CONFIG).map(id => {
    const saved = BANK[id];
    const c = saved && typeof saved === 'object' ? {
      id, name:typeof saved.name === 'string' ? saved.name : defaultComp(id).name,
      weight:parseNum(saved.weight), cuts:Array.from({length:5},(_,g)=>parseNum(saved.cuts?.[g])),
    } : defaultComp(id);
    BANK[id] = c;
    return c;
  });
}
function esc(s){
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function parseNum(v){
  if(typeof v === 'number') return Number.isFinite(v) ? v : null;
  if(typeof v !== 'string') return null;
  const s = v.trim().replace(/,/g,'');
  return /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s) && Number.isFinite(Number(s)) ? Number(s) : null;
}
// 기존 판정 기준 유지: 부동소수점 오차를 정리한 뒤 정수로 반올림한다.
function roundHalfUp(x){ return Math.round(Number(x.toFixed(6))); }
function gradeOf(score){
  if(configErrors.length || !Number.isFinite(score)) return null;
  return GRADES.find((g,i)=>i < 5 && score >= finalCuts[i]) || '미도달';
}
function validateComponents(){
  const errors = [];
  const sum = COMPONENTS.reduce((s,c)=>s+(Number.isFinite(c.weight)?c.weight:0),0);
  if(COMPONENTS.some(c=>!Number.isFinite(c.weight) || c.weight < 0 || c.weight > 100)) errors.push('가중치는 0~100 사이의 숫자를 빠짐없이 입력해 주세요.');
  if(Math.abs(sum-100) > 0.000001) errors.push(`가중치 합이 ${Number(sum.toFixed(6))}%입니다. 100%로 맞춰 주세요.`);
  COMPONENTS.forEach((c,i)=>{
    const label = c.name.trim() || `평가 항목 ${i+1}`;
    if(!c.name.trim()) errors.push(`${label}: 평가 항목 이름을 입력해 주세요.`);
    if(c.cuts.some(v=>!Number.isFinite(v) || v < 0 || v > 100)) errors.push(`${label}: A~E 분할점수를 0~100 사이의 숫자로 모두 입력해 주세요.`);
    else if(c.cuts.some((v,g)=>g>0 && v>c.cuts[g-1])) errors.push(`${label}: 분할점수는 A ≥ B ≥ C ≥ D ≥ E 순서여야 합니다.`);
  });
  return errors;
}
function recomputeFinalCuts(recalculate=true){
  configErrors = validateComponents();
  finalCuts = configErrors.length ? [null,null,null,null,null] : Array.from({length:5},(_,g)=>roundHalfUp(COMPONENTS.reduce((s,c)=>s+c.cuts[g]*c.weight/100,0)));
  const warn = document.getElementById('weightWarn');
  warn.style.display = configErrors.length ? 'block' : 'none';
  warn.textContent = configErrors.length ? '판정 보류: '+configErrors.join(' ') : '';
  GRADES.slice(0,5).forEach((g,i)=>document.getElementById('final'+g).textContent=finalCuts[i] ?? '—');
  if(recalculate && lastStudents.length) runCalculation();
}

const cfgMid = document.getElementById('cfgMid');
const cfgFinal = document.getElementById('cfgFinal');
const cfgPerf = document.getElementById('cfgPerf');
const cutTbody = document.querySelector('#cutTable tbody');
for(let i=0;i<=MAX_PERF;i++) cfgPerf.add(new Option(String(i),String(i)));
function showConfig(){ cfgMid.checked=CONFIG.mid; cfgFinal.checked=CONFIG.final; cfgPerf.value=String(CONFIG.perf); }
function buildCutTable(){
  cutTbody.innerHTML='';
  COMPONENTS.forEach((c,i)=>{
    const tr=document.createElement('tr'); tr.className='cutrow';
    tr.innerHTML=`<td class="comp-name"><input type="text" aria-label="평가 항목 ${i+1} 이름" data-role="name" data-i="${i}" value="${esc(c.name)}"></td>
      <td style="width:90px"><input type="number" min="0" max="100" step="any" aria-label="${esc(c.name)} 가중치" data-role="weight" data-i="${i}" value="${c.weight ?? ''}"></td>
      ${GRADES.slice(0,5).map((g,gi)=>`<td><input type="number" min="0" max="100" step="any" aria-label="${esc(c.name)} ${g} 분할점수" data-role="cut" data-i="${i}" data-g="${gi}" value="${c.cuts[gi] ?? ''}"></td>`).join('')}`;
    cutTbody.appendChild(tr);
  });
  cutTbody.querySelectorAll('input').forEach(el=>el.addEventListener('input',onCutInputChange));
}
function onCutInputChange(e){
  const c=COMPONENTS[+e.target.dataset.i], role=e.target.dataset.role;
  if(role==='name') c.name=e.target.value;
  else if(role==='weight') c.weight=parseNum(e.target.value);
  else if(role==='cut') c.cuts[+e.target.dataset.g]=parseNum(e.target.value);
  saveComponentsToStorage(); recomputeFinalCuts();
}
function onConfigChange(){
  const next={mid:cfgMid.checked,final:cfgFinal.checked,perf:+cfgPerf.value};
  if(!slotIds(next).length){ alert('평가 항목을 하나 이상 골라 주세요.'); showConfig(); return; }
  CONFIG=next; rebuildComponents(); saveComponentsToStorage(); buildCutTable(); recomputeFinalCuts(false);
  if(rawRows.length) parseStudents();
}
[cfgMid,cfgFinal,cfgPerf].forEach(el=>el.addEventListener('change',onConfigChange));

function fillMerges(rows,merges){
  (merges || []).forEach(m=>{
    const value=rows[m.s.r]?.[m.s.c];
    if(value===null || value===undefined || String(value).trim()==='') return;
    for(let r=m.s.r;r<=m.e.r;r++){
      if(!rows[r]) rows[r]=[];
      for(let c=m.s.c;c<=m.e.c;c++) if(rows[r][c]===null || rows[r][c]===undefined || String(rows[r][c]).trim()==='') rows[r][c]=value;
    }
  });
  return rows;
}
function isNumericRow(row){
  const values=row.filter(v=>v!==null && v!==undefined && String(v).trim()!=='');
  return values.length>=2 && values.filter(v=>parseNum(v)!==null).length>=Math.max(2,Math.floor(values.length/2));
}
function detectAnchorRow(rows){
  const i=rows.findIndex(row=>row.some(v=>typeof v==='string' && /성명|이름/.test(v.replace(/\s/g,''))));
  return i<0 ? 0 : i;
}
function detectDataStartRow(rows,anchor){
  const nameCols=(rows[anchor] || []).map((v,c)=>/성명|이름/.test(String(v ?? '').replace(/\s/g,''))?c:-1).filter(c=>c>=0);
  for(let r=anchor+1;r<rows.length;r++){
    const row=rows[r];
    const namedStudent=nameCols.some(c=>typeof row[c]==='string' && /\p{L}/u.test(row[c]) && !isHeaderName(row[c]) &&
      (c===0 || row.slice(0,c).some(v=>parseNum(v)!==null || /^\d+\s*[/\-]\s*\d+$/.test(String(v ?? '').trim()))));
    if(namedStudent || (!nameCols.length && isNumericRow(row))) return r;
  }
  // 모든 학생의 점수가 비어 있어도 이름/학반번호가 있는 명단은 유지한다.
  return anchor+1;
}
function headerLabel(rows,c){
  return [...new Set(rows.slice(anchorRow,dataStartRow).map(row=>String(row[c] ?? '').trim()).filter(Boolean))].join(' / ');
}
function isHeaderName(name){
  return /성적일람표|^(?:성명|이름|반영비율|평가방법|평가영역|명칭|영역|합계|평균|총점)(?:$|[(/,:])|^\d+학년/.test(String(name).replace(/\s/g,''));
}
function detectNameCol(rows){
  const width=Math.max(0,...rows.map(row=>row.length));
  let best=-1,bestCount=-1;
  for(let c=0;c<width;c++){
    if(!/성명|이름/.test(headerLabel(rows,c).replace(/\s/g,''))) continue;
    const count=rows.slice(dataStartRow).filter(row=>typeof row[c]==='string' && /\p{L}/u.test(row[c]) && !isHeaderName(row[c])).length;
    if(count>bestCount || (count===bestCount && c>best)){ best=c;bestCount=count; }
  }
  return best;
}
function mergeContinuations(merges){
  const set=new Set();
  (merges || []).forEach(m=>{ for(let r=m.s.r;r<=m.e.r;r++) for(let c=m.s.c+1;c<=m.e.c;c++) set.add(r+','+c); });
  return set;
}
function findScoreCols(rows,nameCol){
  const cont=mergeContinuations(lastMerges), cols=[];
  const width=Math.max(0,...rows.map(row=>row.length));
  for(let c=nameCol+1;c<width;c++){
    const dataRows=rows.slice(dataStartRow);
    const numeric=dataRows.some((row,i)=>!cont.has((i+dataStartRow)+','+c) && parseNum(row[c])!==null);
    const label=headerLabel(rows,c).replace(/\s/g,'');
    const hasHeader=/(중간|기말|수행|평가|합계|총점|\d+(?:\.\d+)?%)/.test(label);
    const ownHeader=rows.slice(anchorRow,dataStartRow).some((row,i)=>!cont.has((i+anchorRow)+','+c) && String(row[c] ?? '').trim());
    if(numeric || (hasHeader && ownHeader)) cols.push(c);
  }
  return cols;
}
function colLetter(i){
  let s='';for(i++;i>0;i=Math.floor((i-1)/26)) s=String.fromCharCode(65+(i-1)%26)+s;
  return s;
}
function detectClassNoCol(rows,nameCol){
  let best=-1,count=-1;
  for(let c=0;c<nameCol;c++){
    const n=rows.slice(dataStartRow).filter(row=>/^\d+\s*[/\-]\s*\d+$/.test(String(row[c] ?? '').trim())).length;
    if(n>count){ best=c;count=n; }
  }
  if(count>0) return best;
  for(let c=0;c<nameCol;c++) if(/학번|학반번호|번호/.test(headerLabel(rows,c).replace(/\s/g,''))) return c;
  return nameCol>0 ? nameCol-1 : -1;
}
function loadFromFileRows(rows,merges){
  const width=Math.max(0,...rows.map(row=>(row || []).length));
  rawRows=rows.map(row=>Array.from({length:width},(_,c)=>row?.[c] ?? null));
  lastMerges=merges || [];fillMerges(rawRows,lastMerges);
  anchorRow=detectAnchorRow(rawRows); dataStartRow=detectDataStartRow(rawRows,anchorRow);
  parseStudents();
}
function clearResults(){
  lastStudents=[];skippedRows=[];window.__lastRows=[];
  document.getElementById('parseInfo').textContent='';
  document.getElementById('mapInfo').textContent='';
  renderSummary([]);renderTable([]);document.getElementById('exportBtn').disabled=true;
}
function clearStudentData(){
  rawRows=[];lastMerges=[];anchorRow=0;dataStartRow=1;currentWorkbook=null;
  clearResults();
  document.getElementById('sheetRow').style.display='none';
  document.getElementById('sheetSelect').innerHTML='';
  document.getElementById('fileErr').textContent='';document.getElementById('fileErr').style.display='none';
}
function showParseError(msg){
  clearResults();
  const el=document.getElementById('fileErr');el.style.display='block';el.textContent=msg;
}
function parseStudents(){
  document.getElementById('fileErr').style.display='none';clearResults();
  const nameCol=detectNameCol(rawRows);
  if(nameCol<0){ showParseError('성명/이름 머리글을 찾지 못했습니다. 나이스 환산점기준 일람표인지, 선택한 시트가 맞는지 확인해 주세요.');return; }
  const classCol=detectClassNoCol(rawRows,nameCol);
  let found=findScoreCols(rawRows,nameCol),totalCol=null;
  const totalIndex=found.findIndex(c=>/합계|총점/.test(headerLabel(rawRows,c).replace(/\s/g,'')));
  if(totalIndex>=0){ totalCol=found[totalIndex];found=found.slice(0,totalIndex); }
  if(totalCol===null && found.length===COMPONENTS.length+1) totalCol=found.pop();
  if(found.length!==COMPONENTS.length){
    showParseError(`선택한 평가 항목은 ${COMPONENTS.length}개인데 점수 열은 ${found.length}개입니다. 평가 구성과 시트를 확인해 주세요. 전원 빈 점수인 열은 중간·기말·수행 등의 머리글이 필요합니다.`);return;
  }
  const students=[];
  for(let r=dataStartRow;r<rawRows.length;r++){
    const row=rawRows[r],name=String(row[nameCol] ?? '').trim();
    if(!name) continue;
    if(isHeaderName(name)) { skippedRows.push({row:r+1,reason:'제목·머리글·통계 행'});continue; }
    const rawScoreVals=found.map(c=>row[c]);
    const withdrawn=rawScoreVals.some(v=>typeof v==='string' && /자퇴|전출/.test(v));
    students.push({sourceRow:r+1,classNo:String(classCol<0?'':row[classCol] ?? ''),name,rawScoreVals,scores:rawScoreVals.map(parseNum),withdrawn,
      hasFileTotal:totalCol!==null,fileTotal:totalCol===null?null:parseNum(row[totalCol])});
  }
  lastStudents=students;
  document.getElementById('parseInfo').textContent=`${students.length}명 인식됨 · 제목/통계 ${skippedRows.length}행 제외`;
  document.getElementById('mapInfo').innerHTML='파일에서 이렇게 읽었어요: '+COMPONENTS.map((c,i)=>`<b>${esc(c.name)}</b> ← ${colLetter(found[i])}열 (${esc(headerLabel(rawRows,found[i]))})`).join(' · ')+(totalCol===null?' · 합계 열 없음':` · 파일 합계 ← ${colLetter(totalCol)}열`)+
    (skippedRows.length?`<details><summary>제외한 제목·통계 행 확인 (${skippedRows.length}행)</summary>${skippedRows.map(r=>`${r.row}행: ${esc(r.reason)}`).join('<br>')}</details>`:'');
  if(!students.length){ showParseError('학생을 인식하지 못했습니다. 선택한 시트와 성명 머리글을 확인해 주세요.');return; }
  runCalculation();
}
function sheetToRowsFromColumnA(sheet){
  if(!sheet['!ref']) return [];
  const range=XLSX.utils.decode_range(sheet['!ref']);range.s.c=0;range.s.r=0;
  if((range.e.r+1)*(range.e.c+1)>2000000) throw new Error('시트 범위가 너무 큽니다. 불필요한 빈 행/열을 제거해 다시 저장해 주세요.');
  return XLSX.utils.sheet_to_json(sheet,{header:1,defval:null,raw:true,range:XLSX.utils.encode_range(range)});
}
function selectSheet(){
  const sheet=currentWorkbook?.Sheets[document.getElementById('sheetSelect').value];
  if(!sheet){ showParseError('선택한 시트를 읽지 못했습니다.');return; }
  try {
    const rows=sheetToRowsFromColumnA(sheet);
    if(!rows.length) { rawRows=[];showParseError('선택한 시트가 비어 있습니다. 다른 시트를 선택해 주세요.');return; }
    loadFromFileRows(rows,sheet['!merges']);
  } catch(e){ rawRows=[];showParseError('시트를 읽지 못했습니다. '+e.message); }
}
function useWorkbook(wb){
  if(!wb.SheetNames.length) throw new Error('empty');
  currentWorkbook=wb;
  const select=document.getElementById('sheetSelect');select.innerHTML='';
  wb.SheetNames.forEach(name=>select.add(new Option(name,name)));
  select.value=wb.SheetNames[0];
  document.getElementById('sheetRow').style.display=wb.SheetNames.length>1?'flex':'none';
  selectSheet();
}
document.getElementById('sheetSelect').addEventListener('change',selectSheet);
document.getElementById('fileInput').addEventListener('change',e=>{
  const file=e.target.files[0];if(!file) return;
  const token=++fileReadToken;clearStudentData();
  document.getElementById('parseInfo').textContent='파일을 읽는 중입니다…';
  const fail=()=>{
    if(token!==fileReadToken) return;
    clearStudentData();showParseError('파일을 읽지 못했습니다. 나이스 환산점기준 일람표를 XLS/XLSX로 다시 저장해 선택해 주세요.');
    document.getElementById('fileInput').value='';
  };
  const reader=new FileReader();reader.onerror=fail;
  reader.onload=ev=>{
    if(token!==fileReadToken) return;
    try { useWorkbook(XLSX.read(new Uint8Array(ev.target.result),{type:'array',raw:true})); }
    catch(error){
      const textReader=new FileReader();textReader.onerror=fail;
      textReader.onload=ev2=>{
        if(token!==fileReadToken) return;
        try { useWorkbook(XLSX.read(ev2.target.result,{type:'string',raw:true})); } catch(e2){ fail(); }
      };
      textReader.readAsText(file,'utf-8');
    }
  };
  reader.readAsArrayBuffer(file);
});
document.getElementById('clearBtn').addEventListener('click',()=>{
  ++fileReadToken;document.getElementById('fileInput').value='';clearStudentData();
});

function runCalculation(){
  const rows=lastStudents.map(s=>{
    const missing=s.scores.some(v=>v===null);
    const invalid=s.scores.some((v,i)=>v!==null && (v<0 || (Number.isFinite(COMPONENTS[i].weight) && v>COMPONENTS[i].weight+0.000001)));
    const total=missing ? null : s.scores.reduce((a,b)=>a+b,0);
    const rounded=total===null ? null : roundHalfUp(total);
    const complete=!missing && !invalid;
    const totalMismatch=complete && s.fileTotal!==null && (Math.abs(Number(total.toFixed(2))-Number(s.fileTotal.toFixed(2)))>0.000001 || gradeOf(rounded)!==gradeOf(roundHalfUp(s.fileTotal)));
    const issues=[];
    if(configErrors.length) issues.push('평가 설정 확인 필요');
    if(missing) issues.push('빈 점수 또는 숫자가 아닌 점수 있음');
    if(invalid) issues.push('환산점 범위 초과: 각 점수는 0~해당 가중치 이내여야 함');
    if(s.hasFileTotal && s.fileTotal===null) issues.push('파일 합계 미입력/숫자 아님');
    if(totalMismatch) issues.push('파일 합계와 재계산 합계 불일치');
    if(s.fileTotal!==null && (s.fileTotal<0 || s.fileTotal>100)) issues.push('파일 합계 범위 초과');
    const grade=s.withdrawn || issues.length ? null : gradeOf(rounded);
    return {...s,missing,invalid,total,rounded,totalMismatch,issues,grade};
  });
  const sorted=[...rows].sort((a,b)=>(b.total ?? -Infinity)-(a.total ?? -Infinity) || a.sourceRow-b.sourceRow);
  sorted.forEach((r,i)=>r.rank=i+1);
  window.__lastRows=rows;renderSummary(rows);renderTable(rows);
  document.getElementById('exportBtn').disabled=!rows.length;
}
function renderSummary(rows){
  const wrap=document.getElementById('summaryWrap');
  if(!rows.length){ wrap.innerHTML='';return; }
  const valid=rows.filter(r=>r.grade!==null),pending=rows.filter(r=>!r.withdrawn && r.grade===null).length,excluded=rows.filter(r=>r.withdrawn).length;
  const counts=Object.fromEntries(GRADES.map(g=>[g,0]));valid.forEach(r=>counts[r.grade]++);
  wrap.innerHTML=`<p class="hint">인식 ${rows.length}명 · 판정 완료 ${valid.length}명 · 판정 보류 ${pending}명 · 자퇴/전출 ${excluded}명</p>
    <table class="summary"><thead><tr><th>구분</th>${GRADES.map(g=>`<th>${g}</th>`).join('')}<th>합계</th></tr></thead><tbody>
    <tr><td>분할점수(반올림)</td>${finalCuts.map(c=>`<td>${c ?? '—'}</td>`).join('')}<td>—</td><td>—</td></tr>
    <tr><td>인원수</td>${GRADES.map(g=>`<td>${counts[g]}</td>`).join('')}<td>${valid.length}</td></tr>
    <tr><td>비율(%)</td>${GRADES.map(g=>`<td>${valid.length?(counts[g]/valid.length*100).toFixed(1):'—'}</td>`).join('')}<td>${valid.length?'100.0':'—'}</td></tr></tbody></table>
    <p class="hint">비율은 판정 완료 학생만 기준으로 계산합니다. 정렬번호는 합계순 표시 순서이며 나이스 석차가 아닙니다.</p>
    ${pending?`<p class="warn">판정 보류 ${pending}명: 아래 비고를 확인해 주세요. 보류 학생은 성취도 분포에서 제외했습니다.</p>`:''}
    ${rows.some(r=>r.totalMismatch)?'<p class="warn">파일 합계와 재계산 합계가 다릅니다. 원점수 파일을 넣지 않았는지, 평가 열과 환산점기준 여부를 확인해 주세요.</p>':''}`;
}
function note(r){
  return [...(r.withdrawn?['자퇴/전출(통계 제외)']:[]),...r.issues].join(' · ');
}
function formatScore(v){ return v===null || v===undefined ? '—' : v.toFixed(2); }
function renderTable(rows){
  const wrap=document.getElementById('resultTable-wrap');
  if(!rows.length){ wrap.innerHTML='<div class="empty">아직 계산된 결과가 없습니다.</div>';return; }
  wrap.innerHTML=`<table><thead><tr><th>정렬번호</th><th>원본 행</th><th>학반번호</th><th>성명</th>${COMPONENTS.map(c=>`<th>${esc(c.name)}</th>`).join('')}<th>재계산 합계</th><th>파일 합계</th><th>반올림</th><th>성취도</th><th>비고</th></tr></thead><tbody>
    ${[...rows].sort((a,b)=>a.rank-b.rank).map(r=>`<tr${r.withdrawn?' style="opacity:.6"':r.grade===null?' class="missing-row"':''}>
      <td>${r.rank}</td><td>${r.sourceRow}</td><td>${esc(r.classNo)}</td><td>${esc(r.name)}</td>
      ${r.rawScoreVals.map(v=>`<td>${v===null || v===undefined || v===''?'—':esc(v)}</td>`).join('')}
      <td>${formatScore(r.total)}</td><td>${formatScore(r.fileTotal)}</td><td>${r.rounded ?? '—'}</td>
      <td>${r.grade?`<span class="grade-badge g-${r.grade}">${r.grade}</span>`:r.withdrawn?'통계 제외':'판정 보류'}</td><td>${esc(note(r))}</td></tr>`).join('')}</tbody></table>`;
}
// 사용자 입력은 수식으로 내보내지 않는다. 학반번호는 작은따옴표로 텍스트를 표시한다.
function csvCell(v,forceText=false){
  let s=String(v ?? '');
  if(forceText || (typeof v==='string' && /^[\s\uFEFF]*[=+\-@]/.test(s)) || (typeof v==='string' && /^[\t\r\n]/.test(s))) s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}
function buildCsv(rows){
  const header=['정렬번호','원본 행','학반번호','성명',...COMPONENTS.map(c=>c.name),'재계산 합계','파일 합계','반올림','성취도','비고'];
  const lines=[header.map(v=>csvCell(v)).join(',')];
  [...rows].sort((a,b)=>a.rank-b.rank).forEach(r=>lines.push([
    csvCell(r.rank),csvCell(r.sourceRow),csvCell(r.classNo,true),csvCell(r.name),...r.rawScoreVals.map(v=>csvCell(v)),
    csvCell(r.total===null?'':r.total.toFixed(2)),csvCell(r.fileTotal===null?'':r.fileTotal.toFixed(2)),csvCell(r.rounded ?? ''),csvCell(r.grade || (r.withdrawn?'통계 제외':'판정 보류')),csvCell(note(r)),
  ].join(',')));
  return '\uFEFF'+lines.join('\r\n');
}
document.getElementById('exportBtn').addEventListener('click',()=>{
  const rows=window.__lastRows || [];if(!rows.length) return;
  const blob=new Blob([buildCsv(rows)],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='분할점수_계산결과.csv';document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
});
document.getElementById('resetComponentsBtn').addEventListener('click',()=>{
  if(!confirm('평가 구성과 입력한 분할점수를 기본값으로 되돌릴까요?')) return;
  BANK={};CONFIG={...DEFAULT_CONFIG};
  try { [STORAGE_KEY,BANK_KEY,CONFIG_KEY].forEach(k=>localStorage.removeItem(k)); } catch(e) {}
  rebuildComponents();showConfig();buildCutTable();recomputeFinalCuts(false);
  if(rawRows.length) parseStudents();
});
rebuildComponents();showConfig();buildCutTable();recomputeFinalCuts();
