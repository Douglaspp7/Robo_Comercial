document.addEventListener('DOMContentLoaded', () => {
  let csrfToken = '';
  let services = [];
  const q = (id) => document.getElementById(id);
  const money = (cents) => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const esc = (value) => { const el = document.createElement('div'); el.textContent = String(value ?? ''); return el.innerHTML; };
  const localDate = (iso) => new Intl.DateTimeFormat('pt-BR', { weekday:'short', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }).format(new Date(iso));
  async function csrf() { if (csrfToken) return csrfToken; const r = await fetch('/api/csrf-token'); csrfToken = (await r.json()).token; return csrfToken; }
  async function request(url, options = {}) {
    const headers = { ...(options.body ? { 'Content-Type':'application/json' } : {}), ...(options.method && options.method !== 'GET' ? { 'X-CSRF-Token': await csrf() } : {}) };
    const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Não foi possível concluir.');
    if (data?.error) throw new Error(data.error);
    return data;
  }
  function message(text, error = false) { q('pageMessage').innerHTML = text ? `<div class="alert ${error ? 'alert-danger' : 'alert-success'}" style="margin-bottom:14px;">${esc(text)}</div>` : ''; }
  function defaultStart() {
    const date = new Date(Date.now() + 3600000); date.setMinutes(date.getMinutes() < 30 ? 30 : 0, 0, 0); if (date.getMinutes() === 0) date.setHours(date.getHours() + 1);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16); q('appointmentStart').value = local;
  }
  function renderServices() {
    q('appointmentService').innerHTML = services.filter(s => s.active).map(s => `<option value="${esc(s.id)}">${esc(s.name)} · ${s.duration_minutes} min · ${money(s.price_cents)}</option>`).join('');
    q('servicesList').innerHTML = services.length ? services.map(s => `<div class="service-item"><div class="service-head"><strong>${esc(s.name)}</strong><span class="status">${s.active ? 'Ativo' : 'Inativo'}</span></div><div class="service-meta">${s.duration_minutes} min · ${money(s.price_cents)} · taxa ${money(s.booking_fee_cents)}</div></div>`).join('') : '<div class="agenda-empty">Cadastre o primeiro serviço.</div>';
    q('newAppointmentBtn').disabled = !services.some(s => s.active);
  }
  function renderAppointments(items) {
    q('appointmentsList').innerHTML = items.length ? items.map(a => `<div class="appointment-item"><div class="appointment-head"><div><strong>${esc(a.customer_name)}</strong><div class="appointment-meta">${esc(a.service_name)} · ${localDate(a.starts_at)} · ${money(a.fee_amount_cents)} de taxa</div></div><span class="status ${esc(a.status)}">${esc(a.status.replaceAll('_',' '))}</span></div><div class="appointment-actions">${a.status !== 'confirmado' && a.status !== 'cancelado' ? `<button class="btn btn-secondary appointment-status" data-id="${esc(a.id)}" data-status="confirmado">Confirmar</button>` : ''}${a.status !== 'cancelado' ? `<button class="btn btn-ghost appointment-status" data-id="${esc(a.id)}" data-status="cancelado">Cancelar</button>` : ''}</div></div>`).join('') : '<div class="agenda-empty">Nenhum atendimento nos próximos 7 dias.</div>';
    document.querySelectorAll('.appointment-status').forEach(btn => btn.addEventListener('click', async () => { try { const result = await request(`/api/booking/appointments/${btn.dataset.id}/status`, { method:'PATCH', body:JSON.stringify({status:btn.dataset.status}) }); await loadAppointments(); message(result.warning || (btn.dataset.status === 'confirmado' ? 'Agendamento confirmado e cliente avisado.' : 'Agendamento atualizado.'), Boolean(result.warning)); } catch(e) { message(e.message,true); } }));
  }
  async function loadServices() { const data = await request('/api/booking/services'); services = data.services || []; renderServices(); }
  async function loadAppointments() { const from = new Date(); from.setHours(0,0,0,0); const to = new Date(from.getTime()+7*86400000); const data = await request(`/api/booking/appointments?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`); renderAppointments(data.appointments || []); }
  q('serviceForm').addEventListener('submit', async e => { e.preventDefault(); try { await request('/api/booking/services',{method:'POST',body:JSON.stringify({name:q('serviceName').value,duration_minutes:Number(q('serviceDuration').value),price_cents:Math.round(Number(q('servicePrice').value||0)*100),booking_fee_cents:Math.round(Number(q('serviceFee').value||0)*100),active:true})}); e.target.reset(); q('servicePrice').value='0'; q('serviceFee').value='0'; await loadServices(); message('Serviço adicionado.'); } catch(err){message(err.message,true);} });
  q('newAppointmentBtn').addEventListener('click',()=>{q('appointmentForm').hidden=false;defaultStart();q('customerName').focus();});
  q('cancelAppointmentForm').addEventListener('click',()=>{q('appointmentForm').hidden=true;});
  q('appointmentForm').addEventListener('submit',async e=>{e.preventDefault();try{const result=await request('/api/booking/appointments',{method:'POST',body:JSON.stringify({service_id:q('appointmentService').value,customer_name:q('customerName').value,customer_phone:q('customerPhone').value,starts_at:new Date(q('appointmentStart').value).toISOString(),notes:q('appointmentNotes').value})});e.target.reset();e.target.hidden=true;await loadAppointments();const text=result.payment_link?'Horário reservado. A cobrança da taxa foi enviada pelo WhatsApp.':(result.warning||'Horário reservado e cliente avisado.');message(text,Boolean(result.warning));}catch(err){message(err.message,true);}});
  const dayNames=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  function renderWeekly(weekly){
    q('weeklySchedule').innerHTML=dayNames.map((name,day)=>{
      const cfg=weekly?.[day]||weekly?.[String(day)]||{enabled:false,intervals:[]};
      const first=cfg.intervals?.[0]||{start:'08:00',end:'12:00'};
      const second=cfg.intervals?.[1]||null;
      const start=first.start||'08:00';
      const lunchStart=second?first.end:'';
      const lunchEnd=second?.start||'';
      const end=second?.end||first.end||'18:00';
      return `<div class="day-row" data-day="${day}"><label class="day-toggle"><input type="checkbox" class="day-enabled" ${cfg.enabled?'checked':''}> ${name}</label><label class="field"><span>Início</span><input class="form-input day-start" type="time" value="${esc(start)}"></label><label class="field lunch-field"><span>Início intervalo</span><input class="form-input lunch-start" type="time" value="${esc(lunchStart)}"></label><label class="field lunch-field"><span>Fim intervalo</span><input class="form-input lunch-end" type="time" value="${esc(lunchEnd)}"></label><label class="field"><span>Fim</span><input class="form-input day-end" type="time" value="${esc(end)}"></label></div>`;
    }).join('');
  }
  function weeklyPayload(){
    const weekly={};
    document.querySelectorAll('.day-row').forEach(row=>{
      const enabled=row.querySelector('.day-enabled').checked;
      const start=row.querySelector('.day-start').value;
      const end=row.querySelector('.day-end').value;
      const lunchStart=row.querySelector('.lunch-start').value;
      const lunchEnd=row.querySelector('.lunch-end').value;
      const intervals=[];
      if(enabled&&start&&end){
        if(lunchStart&&lunchEnd&&start<lunchStart&&lunchStart<lunchEnd&&lunchEnd<end){
          intervals.push({start,end:lunchStart},{start:lunchEnd,end});
        }else intervals.push({start,end});
      }
      weekly[row.dataset.day]={enabled:enabled&&intervals.length>0,intervals};
    });
    return weekly;
  }
  async function loadAvailability(){
    const data=await request('/api/booking/settings');
    renderWeekly(data.settings.weekly);
    q('minNotice').value=String(data.settings.min_notice_minutes);
    q('maxAdvance').value=String(data.settings.max_advance_days);
    q('bufferMinutes').value=String(data.settings.buffer_minutes);
  }
  function renderBlocks(blocks){
    q('blocksList').innerHTML=blocks.length?blocks.map(b=>`<div class="block-item"><div><strong>${esc(b.reason||'Período bloqueado')}</strong><div class="appointment-meta">${localDate(b.starts_at)} até ${localDate(b.ends_at)}</div></div><button class="btn btn-ghost delete-block" data-id="${esc(b.id)}" type="button">Remover</button></div>`).join(''):'<div class="agenda-empty">Nenhuma folga futura bloqueada.</div>';
    document.querySelectorAll('.delete-block').forEach(btn=>btn.addEventListener('click',async()=>{try{await request(`/api/booking/blocks/${btn.dataset.id}`,{method:'DELETE'});await loadBlocks();message('Bloqueio removido.');}catch(err){message(err.message,true);}}));
  }
  async function loadBlocks(){const data=await request('/api/booking/blocks');renderBlocks(data.blocks||[]);}
  q('availabilityForm').addEventListener('submit',async e=>{e.preventDefault();try{await request('/api/booking/settings',{method:'PUT',body:JSON.stringify({weekly:weeklyPayload(),min_notice_minutes:Number(q('minNotice').value),max_advance_days:Number(q('maxAdvance').value),buffer_minutes:Number(q('bufferMinutes').value)})});message('Disponibilidade salva. A IA já usará estes horários.');}catch(err){message(err.message,true);}});
  q('blockForm').addEventListener('submit',async e=>{e.preventDefault();try{await request('/api/booking/blocks',{method:'POST',body:JSON.stringify({starts_at:new Date(q('blockStart').value).toISOString(),ends_at:new Date(q('blockEnd').value).toISOString(),reason:q('blockReason').value})});e.target.reset();await loadBlocks();message('Período bloqueado.');}catch(err){message(err.message,true);}});
  (async()=>{try{const settings=await request('/api/settings');if(settings.business?.tipo_negocio!=='servicos'){location.replace('/dashboard.html');return;}await Promise.all([loadServices(),loadAppointments(),loadAvailability(),loadBlocks()]);if(window.lucide)window.lucide.createIcons();}catch(err){console.error('[Agenda]',err);message('Não foi possível carregar a Agenda agora. Atualize a página e tente novamente.',true);}})();
});