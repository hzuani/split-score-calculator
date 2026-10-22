const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..')+path.sep;
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
assert.equal(scripts[0],fs.readFileSync(path.join(root,'vendor/xlsx.full.min.js'),'utf8'),'embedded library matches preserved vendor copy');
const nodes=new Map(),readers=[];
function node(){return {style:{},innerHTML:'',textContent:'',value:'',disabled:false,checked:false,events:{},options:[],addEventListener(k,cb){this.events[k]=cb},add(o){this.options.push(o)},appendChild(){},querySelectorAll(){return []},click(){}}}
const ctx={document:{getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},querySelector(){return node()},createElement(){return node()},body:{appendChild(){},removeChild(){}}},localStorage:{getItem(){return null},setItem(){},removeItem(){}},Option:function(label,value){this.text=label;this.value=value},FileReader:class{constructor(){readers.push(this)}readAsArrayBuffer(){}readAsText(){}},alert(){},confirm(){return true},window:{},console,Uint8Array,ArrayBuffer,Blob,URL};
vm.createContext(ctx);scripts.forEach(s=>vm.runInContext(s,ctx));
const run=s=>vm.runInContext(s,ctx);
const get=s=>JSON.parse(JSON.stringify(run(s)));
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS',name)}
const headers=['순번','학반번호','성명','중간고사','기말고사','수행평가1','수행평가2','합계'];
function load(rows){ctx.fixture=[headers,...rows];run('loadFromFileRows(fixture,[])')}
function reset(){run('BANK={};CONFIG={...DEFAULT_CONFIG};rebuildComponents();recomputeFinalCuts(false);clearStudentData()')}
test('original rounding boundaries unchanged',()=>assert.deepEqual(get('finalCuts'),[84,75,62,48,21]));
test('zero weight configuration holds all results',()=>{load([[1,'1/1','가상가',30,30,20,20,100]]);run('COMPONENTS.forEach(c=>c.weight=0);recomputeFinalCuts()');assert.equal(run('window.__lastRows[0].grade'),null);assert.ok(run('configErrors.length'));reset()});
test('blank setting is not converted to zero',()=>{run(`onCutInputChange({target:{dataset:{i:'0',role:'weight'},value:''}})`);assert.equal(run('COMPONENTS[0].weight'),null);assert.ok(run('configErrors.length'));reset()});
test('negative, overrange and reversed cut settings blocked',()=>{for(const expr of ['COMPONENTS[0].weight=-1','COMPONENTS[0].cuts[0]=101','COMPONENTS[0].cuts[1]=99']){run(expr+';recomputeFinalCuts(false)');assert.ok(run('configErrors.length'));reset()}});
test('blank and absence scores held; fully blank student retained',()=>{load([[1,'1/1','가상가',20,null,15,15,50],[2,'1/2','가상나',20,'결시',15,15,50],[3,'1/3','가상다',null,null,null,null,null]]);assert.equal(run('window.__lastRows.length'),3);assert.equal(run('window.__lastRows.every(r=>r.grade===null)'),true);assert.equal(run('window.__lastRows.every(r=>r.total===null)'),true)});
test('zero score remains a real score',()=>{load([[1,'1/1','가상가',0,0,0,0,0]]);assert.equal(run('window.__lastRows[0].grade'),'미도달')});
test('first blank student retained before later complete students',()=>{load([[1,'1/1','가상가',null,null,null,null,null],[2,'1/2','가상나',30,30,20,20,100]]);assert.equal(run('window.__lastRows.length'),2);assert.equal(run('window.__lastRows[0].sourceRow'),2);assert.equal(run('window.__lastRows[0].grade'),null);assert.equal(run('window.__lastRows[1].grade'),'A')});
test('entirely blank evaluation column retained by header',()=>{load([[1,'1/1','가상가',null,20,15,15,50],[2,'1/2','가상나',null,20,15,15,50]]);assert.equal(run('window.__lastRows.length'),2);assert.equal(run('window.__lastRows.every(r=>r.grade===null)'),true)});
test('0.01 boundary mismatch held and displayed',()=>{load([[1,'1/1','가상가',20,20,10,11.49,61.50]]);assert.equal(run('window.__lastRows[0].totalMismatch'),true);assert.equal(run('window.__lastRows[0].grade'),null);assert.ok(nodes.get('resultTable-wrap').innerHTML.includes('61.50'))});
test('out of converted score range held',()=>{load([[1,'1/1','가상가',31,20,15,15,81],[2,'1/2','가상나',-1,20,15,15,49]]);assert.equal(run('window.__lastRows.every(r=>r.invalid && r.grade===null)'),true)});
test('metadata numeric rows excluded; foreign names supported',()=>{load([[null,null,'반영비율',30,30,20,20,100],[1,'1/1','Alice',30,30,20,20,100],[2,'1/2','Student2',30,30,20,20,100]]);assert.equal(run('window.__lastRows.length'),2);assert.equal(run('window.__lastRows.some(r=>r.name==="반영비율")'),false);assert.equal(run('window.__lastRows.every(r=>r.grade==="A")'),true)});
test('HTML values escaped in table and header',()=>{load([[1,'<b>1/1</b>','<img src=x onerror=alert(1)>',30,30,20,20,100]]);run(`COMPONENTS[0].name='<img src=x onerror=alert(1)>';recomputeFinalCuts()`);const result=nodes.get('resultTable-wrap').innerHTML;assert.equal(result.includes('<img'),false);assert.ok(result.includes('&lt;img'));reset()});
test('CSV formulas blocked, identifiers emitted as text',()=>{for(const s of ['=1+1','+1','-1','@SUM(1)','  =1','\t=1']){ctx.csvValue=s;assert.ok(run('csvCell(csvValue)').startsWith('"\''))}assert.equal(run(`csvCell('1/1',true)`),'"\'1/1"');assert.equal(run('csvCell(-1)'), '"-1"')});
test('pending rows included in export without a grade',()=>{load([[1,'1/1','가상가',20,null,15,15,50]]);const csv=run('buildCsv(window.__lastRows)');assert.ok(csv.includes('판정 보류'));assert.ok(csv.includes('빈 점수'));assert.equal(csv.split('\r\n').length,2)});
test('clear removes all student data and export state',()=>{nodes.get('clearBtn').events.click();assert.equal(run('window.__lastRows.length+lastStudents.length+rawRows.length+lastMerges.length'),0);assert.equal(nodes.get('mapInfo').textContent,'');assert.equal(nodes.get('exportBtn').disabled,true);assert.equal(run('currentWorkbook'),null)});
test('parse error clears stale export data',()=>{load([[1,'1/1','가상가',30,30,20,20,100]]);run('showParseError("test")');assert.equal(run('window.__lastRows.length'),0);assert.equal(nodes.get('exportBtn').disabled,true)});
test('worksheet offsets and merged cells preserved',()=>{
  ctx.offsetSheet={'!ref':'B5:I6','!merges':[{s:{r:5,c:2},e:{r:5,c:3}}],B5:{t:'s',v:'학반번호'},C5:{t:'s',v:'성명'},E5:{t:'s',v:'중간고사'},F5:{t:'s',v:'기말고사'},G5:{t:'s',v:'수행평가1'},H5:{t:'s',v:'수행평가2'},I5:{t:'s',v:'합계'},B6:{t:'s',v:'1/1'},C6:{t:'s',v:'가상가'},E6:{t:'n',v:30},F6:{t:'n',v:30},G6:{t:'n',v:20},H6:{t:'n',v:20},I6:{t:'n',v:100}};
  assert.equal(run(`fillMerges(sheetToRowsFromColumnA(offsetSheet),offsetSheet['!merges'])[5][3]`),'가상가');
});
test('multiple sheet selection and empty sheet clear previous result',()=>{
  const wb=ctx.XLSX.utils.book_new();ctx.XLSX.utils.book_append_sheet(wb,ctx.XLSX.utils.aoa_to_sheet([['안내']]),'안내');ctx.XLSX.utils.book_append_sheet(wb,ctx.XLSX.utils.aoa_to_sheet([headers,[1,'1/1','가상가',30,30,20,20,100]]),'성적');ctx.multiWorkbook=wb;run('useWorkbook(multiWorkbook)');assert.equal(run('window.__lastRows.length'),0);nodes.get('sheetSelect').value='성적';run('selectSheet()');assert.equal(run('window.__lastRows.length'),1);nodes.get('sheetSelect').value='안내';run('selectSheet()');assert.equal(run('window.__lastRows.length'),0);
});
test('failed file and callbacks after clear cannot retain old results',()=>{
  load([[1,'1/1','가상가',30,30,20,20,100]]);nodes.get('fileInput').events.change({target:{files:[{}]}});assert.equal(run('window.__lastRows.length'),0);readers.at(-1).onerror();assert.equal(run('window.__lastRows.length'),0);assert.equal(nodes.get('exportBtn').disabled,true);
  nodes.get('fileInput').events.change({target:{files:[{}]}});const old=readers.at(-1);nodes.get('clearBtn').events.click();old.onload({target:{result:new ArrayBuffer(0)}});assert.equal(run('window.__lastRows.length'),0);
});
test('CSV upload preserves class identifiers and matches documented sample',()=>{
  nodes.get('fileInput').events.change({target:{files:[{}]}});
  const input=fs.readFileSync(path.join(root,'examples/sample.csv'));
  readers.at(-1).onload({target:{result:input}});
  assert.equal(run('window.__lastRows.length'),9);
  assert.equal(run('window.__lastRows[0].classNo'),'1/1');
  assert.equal(run('window.__lastRows.filter(r=>r.grade!==null).length'),6);
});
console.log('TOTAL',passed,'tests passed');
