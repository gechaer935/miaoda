package httpapi

// adminFixScript avoids malformed inline handlers and native prompt/confirm
// dialogs, which are not supported by every embedded browser.
const adminFixScript = `<style>
.admin-modal-mask{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.42);backdrop-filter:blur(4px)}
.admin-modal-mask.open{display:flex}.admin-modal{width:min(430px,100%);padding:24px;border:1px solid #e8ecf5;border-radius:18px;background:#fff;box-shadow:0 24px 70px rgba(30,41,59,.22)}
.admin-modal h3{margin:0 0 8px;font-size:20px}.admin-modal p{margin:0;color:#697386;line-height:1.65}.admin-modal-fields{display:grid;gap:12px;margin-top:18px}.admin-modal-fields label{display:grid;gap:7px;color:#4a5568;font-size:13px;font-weight:650}.admin-modal-fields input{width:100%;box-sizing:border-box}
.admin-modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:24px}.admin-modal-actions button{min-width:88px}.admin-modal-actions .primary{color:#fff;background:#5868f7}.admin-modal-actions .danger{color:#fff;background:#e75263}
</style><script>
(function(){
  var mask=document.createElement('div');
  mask.className='admin-modal-mask';
  mask.innerHTML='<div class="admin-modal"><h3 id="admin-modal-title"></h3><div id="admin-modal-body"></div><div class="admin-modal-actions"><button class="btn" id="admin-modal-cancel">\u53d6\u6d88</button><button class="btn primary" id="admin-modal-ok">\u786e\u8ba4</button></div></div>';
  document.body.appendChild(mask);
  var title=mask.querySelector('#admin-modal-title');
  var body=mask.querySelector('#admin-modal-body');
  var cancel=mask.querySelector('#admin-modal-cancel');
  var ok=mask.querySelector('#admin-modal-ok');
  var close=function(){mask.classList.remove('open')};
  cancel.addEventListener('click',close);
  mask.addEventListener('click',function(e){if(e.target===mask)close()});
  function openModal(heading,content,onConfirm,danger){
    title.textContent=heading;body.innerHTML=content;
    ok.className='btn '+(danger?'danger':'primary');
    ok.disabled=false;mask.classList.add('open');
    ok.onclick=async function(){ok.disabled=true;try{await onConfirm();close()}catch(e){msg(e.message)}finally{ok.disabled=false}};
  }
  recharge=function(k){
    openModal('\u5145\u503c','<p>\u4e3a\u5361\u5bc6 <b>'+esc(k)+'</b> \u589e\u52a0\u989d\u5ea6</p><div class="admin-modal-fields"><label>\u589e\u52a0\u9762\u8bd5\u65f6\u957f\uff08\u5206\u949f\uff09<input id="modal-minutes" type="number" min="0" step="1" value="60"></label><label>\u589e\u52a0\u7b14\u8bd5\u989d\u5ea6\uff08\u9898\uff09<input id="modal-questions" type="number" min="0" step="1" value="10"></label></div>',async function(){
      var seconds=Math.round(Number(mask.querySelector('#modal-minutes').value)*60);var questions=Number(mask.querySelector('#modal-questions').value);
      await api('/cards/recharge',{method:'POST',body:JSON.stringify({cardKey:k,interviewSeconds:seconds,writtenQuestions:questions})});msg('\u5145\u503c\u6210\u529f');await load();
    },false);
  };
  resetDev=function(k){
    openModal('\u6e05\u9664\u8bbe\u5907','<p>\u786e\u5b9a\u6e05\u9664\u8be5\u5361\u5bc6\u7684\u6240\u6709\u8bbe\u5907\u7ed1\u5b9a\uff1f</p>',async function(){await api('/cards/reset-devices',{method:'POST',body:JSON.stringify({cardKey:k})});msg('\u8bbe\u5907\u5df2\u6e05\u9664');await load()},false);
  };
  removeCard=function(k){
    openModal('\u5220\u9664\u5361\u5bc6','<p>\u5220\u9664 <b>'+esc(k)+'</b> \u540e\u4e0d\u53ef\u6062\u590d\uff0c\u786e\u5b9a\u7ee7\u7eed\uff1f</p>',async function(){await api('/cards/'+encodeURIComponent(k),{method:'DELETE'});msg('\u5361\u5bc6\u5df2\u5220\u9664');await load()},true);
  };
  document.addEventListener('click',function(event){
    var button=event.target.closest('.actions button');if(!button)return;
    event.preventDefault();event.stopImmediatePropagation();
    var row=button.closest('tr');var key=row&&row.querySelector('.key')?row.querySelector('.key').textContent.trim():'';if(!key)return;
    var buttons=Array.prototype.slice.call(button.parentElement.children);var index=buttons.indexOf(button);
    if(index===0)recharge(key);if(index===1)resetDev(key);if(index===2)removeCard(key);
  },true);
})();
</script>`
