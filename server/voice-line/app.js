const $ = id => document.getElementById(id);
const node = (tag, text) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element; };
const stateText = { pending: '等待核對', sending: '等待送出結果確認', succeeded: '已確認送出', failed: '傳送失敗', unknown: '結果待確認' };
const errors = { CLAIM_INVALID: '領取碼不符、已使用或已到期', RECIPIENT_UNVERIFIED: '來源與送出聊天室不符，請重新核對', DELIVERY_ALREADY_ATTEMPTED: '這筆工作已處理，請核對既有結果', DOCUMENT_STALE: '成果已更新，請由會員重新申請', OWNER_REQUIRED: '此頁僅供營運管理者使用', LOGIN_REQUIRED: '請重新登入報數據' };
async function api(action, input) { const response = await fetch('/bdmin/voice-line/api/' + action, { credentials: 'same-origin', headers: input ? { 'content-type': 'application/json', 'x-voice-line-action': action } : {}, method: input ? 'POST' : 'GET', body: input ? JSON.stringify(input) : undefined }); const data = await response.json(); if (!response.ok) throw new Error(errors[data.error] ?? data.error ?? '目前無法取得工作，請重新整理'); return data; }
function field(form, label, type = 'text') { const wrapper = node('label', label); const input = type === 'textarea' ? node('textarea') : node('input'); if (type !== 'textarea') input.type = type; wrapper.append(input); form.append(wrapper); return input; }
async function load() {
  try {
    const result = await api('tasks'); $('tasks').replaceChildren();
    if (!result.tasks.length) $('tasks').append(node('p', '目前沒有 LINE 交付工作'));
    for (const task of result.tasks) {
      const article = node('article'); article.dataset.jobId = task.id;
      article.append(node('h2', task.documentTitle), node('p', `會員：${task.memberEmail ?? '會員信箱無法取得'} · ${stateText[task.state]}`), node('p', `建立：${new Date(task.createdAt).toLocaleString('zh-TW')} · 到期：${new Date(task.expiresAt).toLocaleString('zh-TW')}`));
      if (task.state === 'pending' && task.currentDocument) {
        const form = node('form'); form.append(node('p', '從收到領取碼的 LINE 聊天室核對會員與代碼，再核對準備送出的聊天室'));
        const code = field(form, '聊天室收到的領取碼'); code.required = true; code.autocomplete = 'off';
        const observed = field(form, '收到領取碼的聊天室識別'); observed.required = true;
        const target = field(form, '目前準備送出的聊天室識別'); target.required = true;
        const check = field(form, '已核對會員、代碼與兩個聊天室一致', 'checkbox'); check.required = true;
        const button = node('button', '核對並取得成果連結'); button.type = 'submit'; form.append(button);
        form.addEventListener('submit', async event => { event.preventDefault(); button.disabled = true; try { await api('prepare', { jobId: task.id, claimCode: code.value.trim(), observedChatRef: observed.value.trim(), chatRef: target.value.trim(), attemptId: crypto.randomUUID(), officialAccount: '@791vlxya', supervised: check.checked }); $('notice').textContent = '核對完成，請到同一個 LINE 聊天室送出成果連結，再回來登記結果'; await load(); } catch (error) { $('notice').textContent = error.message; button.disabled = false; } }); article.append(form);
      }
      if (task.state === 'sending' && task.attempt) {
        article.append(node('p', `已核對聊天室：${task.attempt.chatRef}`), node('p', '在 LINE 後台送出前，核對目前聊天室與既有送出紀錄'));
        if (task.resultUrl) article.append(node('pre', task.resultUrl));
        const form = node('form'); const room = field(form, '實際送出的聊天室識別'); room.required = true;
        const wrapper = node('label', '實際結果'); const outcome = node('select'); for (const [value, label] of [['sent', '已確認送出'], ['rejected', '傳送失敗'], ['unknown', '結果待確認']]) { const option = node('option', label); option.value = value; outcome.append(option); } wrapper.append(outcome); form.append(wrapper);
        const receipt = field(form, 'LINE 送出紀錄或錯誤紀錄', 'textarea'); receipt.required = true;
        const evidence = field(form, '送出畫面的 SHA-256');
        const checked = field(form, '已核對同一聊天室的實際結果', 'checkbox'); checked.required = true;
        const button = node('button', '登記結果'); button.type = 'submit'; form.append(button);
        form.addEventListener('submit', async event => { event.preventDefault(); if (!checked.checked) return; button.disabled = true; try { await api('complete', { jobId: task.id, attemptId: task.attempt.id, officialAccount: '@791vlxya', chatRef: room.value.trim(), outcome: outcome.value, receipt: receipt.value.trim(), ...(evidence.value.trim() ? { evidenceSha256: evidence.value.trim() } : {}) }); $('notice').textContent = '交付結果已登記'; await load(); } catch (error) { $('notice').textContent = error.message; button.disabled = false; } }); article.append(form);
      }
      if (task.attempt?.evidence) article.append(node('p', `結果紀錄：${task.attempt.evidence.receipt}`));
      $('tasks').append(article);
    }
  } catch (error) { $('notice').textContent = error.message; }
}
$('refresh').addEventListener('click', load); void load();
