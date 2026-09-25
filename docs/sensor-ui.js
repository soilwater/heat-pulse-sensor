/* One current sensor, one measurement cycle. All configuration beyond timing and duty is
 * fixed to the latest flat-board example; explanations are shown on demand. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const S = window.SensorModel, B = window.SensorBoard;
  const parts = Object.fromEntries(B.footprints.map(p => [p.ref,p]));
  // TH4 (board) is drawn but not reported: board heating is not modeled.
  const refs = ['TH1','TH2','TH3'];
  const fixedConfig = () => ({...S.defaultConfig(),maxBatteryV:14.4});
  const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = (value,digits=2) => Number.isFinite(value)?value.toFixed(digits):'—';
  const watts = value => value>=1?fmt(value,3)+' W':fmt(value*1000,1)+' mW';
  const svgNode = (tag,attrs={},text) => {
    const e=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [key,value] of Object.entries(attrs))e.setAttribute(key,value);
    if(text!==undefined)e.textContent=text;
    return e;
  };
  const settingKeys=['baselineS','pulseS','cooldownS','dutyPct'];
  // Temperature chart frame, in viewBox units (index.html: viewBox 0 0 560 158).
  const CHART={left:40,top:18,width:508,height:108};
  // Soil: one measured Kansas Mesonet reading, chosen in the Select soil dialog. Without the
  // data file the model's default properties are used.
  let soil={id:'default',label:'Model default soil',lambda:S.defaultConfig().soilLambda,C:S.defaultConfig().soilC};
  const CS_MINERAL=0.75, CW=4.18; // MJ/(Mg·K) and MJ/(m³·K): de Vries water content from C and bulk density
  let estimate=null;
  const soilText=s=>'λ '+fmt(s.lambda,2)+' W/(m·K) · C '+fmt(s.C/1e6,2)+' MJ/(m³·K)'+(s.theta!==undefined?' · θ '+fmt(s.theta,2):'');
  const gateCommand=()=>state.d9?(cfg.dutyPct===100?'HIGH':'PWM · '+cfg.dutyPct+'%'):'LOW';
  let cfg={...fixedConfig(),soilId:soil.id}, run, state, power, duration=115, time=0;
  let started=false, playing=false, speed=4, valid=true, lastFrame=0, lastPaint=0, selected=null;
  const board=SensorBoardView.mount($('board'),B,openComponent);
  const dialog=$('componentDialog');

  function reset() {
    playing=false;started=false;time=0;
    for(const key of settingKeys)$(key).value=cfg[key];
    $('chartHint').textContent=soil.label+(soil.texture?' · '+soil.texture:'')+' · '+cfg.ambientC+' °C start';
    $('soilName').textContent=soil.label;$('soilDetail').textContent=soil.texture||'';$('soilProps').textContent='λ '+fmt(soil.lambda,2)+' · C '+fmt(soil.C/1e6,2)+(soil.theta!==undefined?' · θ '+fmt(soil.theta,2):'');
    $('soilButton').title='Soil: '+soil.label+(soil.texture?', '+soil.texture:'')+'. '+soilText(soil)+'. Click to change.';
    valid=true;$('inputError').hidden=true;enablePlayback(true);render();
  }
  function enablePlayback(enabled) {for(const id of ['start','time','speed'])$(id).disabled=!enabled;}
  function applyTiming() {
    playing=false;
    const next=fixedConfig();
    const names={baselineS:'Background sensing',pulseS:'Heating',cooldownS:'Cooling sensing',dutyPct:'Heater duty'};
    try {
      for(const key of Object.keys(names)) {
        const input=$(key),value=Number(input.value);
        if(!input.value||!Number.isInteger(value)||value<Number(input.min)||value>Number(input.max))
          throw new RangeError(`${names[key]} must be ${input.min}–${input.max} ${key==='dutyPct'?'percent, in whole numbers':'whole seconds'}.`);
        next[key]=value;
      }
      Object.assign(next,{soilId:soil.id,soilLambda:soil.lambda,soilC:soil.C});
      const nextRun=S.simulate(next,HPTwin);
      cfg=next;run=nextRun;duration=cfg.baselineS+cfg.pulseS+cfg.cooldownS;estimate=S.soilEstimate(run);
      $('time').max=duration;buildChart();reset();
    } catch(error) {
      valid=false;enablePlayback(false);
      $('inputError').textContent=error.message+' Correct the value or reset to continue.';
      $('inputError').hidden=false;
      if(run)render();
    }
  }
  function phaseName() {
    if(!started)return ['idle','Ready'];
    if(time>=duration)return ['complete','Complete'];
    if(time<cfg.baselineS)return ['baseline','Background sensing'];
    if(time<cfg.baselineS+cfg.pulseS)return ['pulse','Heating'];
    return ['cooldown','Cooling sensing'];
  }
  function render() {
    const modelTime=started?run.stages[1].startS+time:0;
    state=S.stateAt(run,modelTime);power=S.instantaneousPower(run,modelTime);
    const [phase,label]=phaseName();
    $('phase').dataset.state=phase;
    $('phase').innerHTML='<i></i>'+label;
    $('clock').innerHTML=fmt(time,1)+' <span>/ '+duration+' s</span>';
    $('time').value=time;
    $('time').setAttribute('aria-valuetext',fmt(time,1)+' seconds, '+label);
    $('start').innerHTML=playing?'<span aria-hidden="true">Ⅱ</span> Pause':time>=duration?'<span aria-hidden="true">↺</span> Run again':started?'<span aria-hidden="true">▶</span> Resume':'<span aria-hidden="true">▶</span> Run measurement';
    document.querySelectorAll('.timing-field').forEach(e=>e.classList.toggle('active',e.dataset.phase===phase));
    const signed=(v,d)=>(v>=0?'+':'')+fmt(v,d);
    refs.forEach((ref,i)=>{
      const temperature=state.temperaturesC[i];
      $('temp-'+ref).textContent=fmt(temperature,3)+' °C';
      $('rise-'+ref).textContent=signed(temperature-cfg.ambientC,3);
    });
    $('tempHeatedZone').textContent=fmt(state.heatedZoneSoilC,2)+' °C';
    $('rise-heatedZone').textContent=signed(state.heatedZoneSoilC-cfg.ambientC,2);
    $('batteryPower').textContent=watts(power.batteryW);
    $('batteryCurrent').textContent=fmt(power.batteryCurrentA*1000,1)+' mA';
    $('eachHeater').textContent=fmt(power.perHeaterW[0].powerW*1000,1)+' mW each';
    $('heatEnergy').textContent=fmt(state.energyJ,2)+' J';
    renderEstimate(started&&time>=duration);
    const values={heaters:power.heaterW,regulator:power.U3dissipationW,logic:power.logicRailW,
      diodes:power.D1W+power.D7dissipationW,shunt:power.shuntW,switch:power.mosfetW,wiring:power.cableW+power.copperW};
    for(const [key,value] of Object.entries(values))$('power-'+key).textContent=watts(value);
    $('boardStatus').textContent=phase==='idle'?'Electronics powered · run to show current flow':state.heaterOn?cfg.dutyPct+'% duty · '+fmt(state.currentA*1000,1)+' mA average':phase==='pulse'?'0% duty · heater off':phase==='cooldown'?'Heater off · heat continues spreading':'Heater off · electronics powered';
    board.update(state,run,playing);
    const x=CHART.left+time/duration*CHART.width;
    $('traceClip').setAttribute('width',Math.max(.1,x-CHART.left));
    $('plotCursor').setAttribute('x1',x);$('plotCursor').setAttribute('x2',x);
    $('plotCursor').setAttribute('opacity',started?'1':'0');
    if(dialog.open)renderDialogValues();
  }
  // Sensor estimate: the simulated TH1 ADC record analysed as firmware would, shown once cooling ends.
  function estimateRows() {
    const e=estimate,signedPct=v=>(v>=0?'+':'')+fmt(v,1)+'%',err=(a,b)=>signedPct(100*(a/b-1));
    const thetaFrom=C=>soil.bd?(C/1e6-soil.bd*CS_MINERAL)/CW:NaN;
    if(!e)return {e,rows:[]};
    const dTheta=thetaFrom(e.C)-soil.theta;
    return {e,rows:[
      ['estLambda',fmt(e.lambda,3),'estLambdaRef',fmt(cfg.soilLambda,3),err(e.lambda,cfg.soilLambda)],
      ['estC',fmt(e.C/1e6,3),'estCRef',fmt(cfg.soilC/1e6,3),err(e.C,cfg.soilC)],
      ['estTheta',fmt(thetaFrom(e.C),3),'estThetaRef',fmt(soil.theta,3),Number.isFinite(dTheta)?(dTheta>=0?'+':'')+fmt(dTheta,3):'']]};
  }
  function renderEstimate(done) {
    const {e,rows}=estimateRows();
    for(const id of ['estLambda','estC','estTheta','estLambdaRef','estCRef','estThetaRef'])$(id).textContent='—';
    if(!e){$('estStatus').textContent='No estimate: the heater is off or a sensor fault is active.';return;}
    for(const [id,value,refId,ref,err] of rows){$(refId).textContent=ref;if(done)$(id).innerHTML=esc(value)+' <small>'+esc(err)+'</small>';}
    $('estStatus').textContent=done?'Line-source fit of '+e.samples+' TH1 readings (14-bit ADC, 64 averaged) · q′ '+fmt(e.qPrimeWm,1)+' W/m':'Sensor values appear when cooling ends.';
  }
  function buildChart() {
    const chart=$('temperatureChart');chart.replaceChildren();
    const {left,top,width,height}=CHART;
    const max=Math.ceil(Math.max(.1,...run.series.map(p=>Math.max(p.tempL,p.tempTip)-cfg.ambientC))*1.1*20)/20;
    const px=t=>left+t/duration*width,py=t=>top+height-(t-cfg.ambientC)/max*height;
    const defs=svgNode('defs'),clip=svgNode('clipPath',{id:'liveTraceClip'});
    clip.append(svgNode('rect',{id:'traceClip',x:left,y:top-2,width:.1,height:height+4}));defs.append(clip);chart.append(defs);
    const intervals=[['Background',0,cfg.baselineS,'#f6f8f4'],['Heating',cfg.baselineS,cfg.baselineS+cfg.pulseS,'#fdf2e3'],['Cooling',cfg.baselineS+cfg.pulseS,duration,'#fafbf8']];
    for(const [name,start,end,color] of intervals) {
      const w=px(end)-px(start);
      chart.append(svgNode('rect',{x:px(start),y:top,width:w,height,fill:color,class:'phase-bg phase-'+name.toLowerCase()}));
      if(w>48)chart.append(svgNode('text',{x:(px(start)+px(end))/2,y:11,'text-anchor':'middle',class:'plot-phase'},name));
    }
    for(let i=0;i<=4;i++) {
      const y=top+height-height*i/4;
      chart.append(svgNode('line',{x1:left,y1:y,x2:left+width,y2:y,stroke:'#e6ece3','stroke-width':.8,class:'chart-grid'}));
      chart.append(svgNode('text',{x:left-9,y:y+3,'text-anchor':'end',class:'axis-label'},fmt(max*i/4,2)));
    }
    const step=duration>400?120:duration>200?60:duration>80?20:10;
    for(let t=0;t<=duration;t+=step)chart.append(svgNode('text',{x:px(t),y:height+top+19,'text-anchor':'middle',class:'axis-label'},t));
    chart.append(svgNode('text',{x:7,y:12,class:'axis-label'},'°C'),svgNode('text',{x:width+left,y:top+height+31,'text-anchor':'end',class:'axis-label'},'Time, s'));
    const traces=svgNode('g',{'clip-path':'url(#liveTraceClip)'}),start=run.stages[1].startS;
    const series=run.series.filter(p=>p.t>=start&&p.t<=start+duration);
    for(const [key,color,dash,sw] of [['tempL','#297964','none',2.3],['tempR','#578bbb','3 8',1.8],['tempTip','#d9923c','none',2.2]]) {
      const d=series.map((p,i)=>(i?'L':'M')+fmt(px(p.t-start),2)+','+fmt(py(p[key]),2)).join(' ');
      traces.append(svgNode('path',{d,fill:'none',stroke:color,'stroke-width':sw,'stroke-dasharray':dash,class:'trace trace-'+key}));
    }
    chart.append(traces,svgNode('line',{id:'plotCursor',class:'chart-cursor',x1:left,y1:top,x2:left,y2:top+height,stroke:'#607964','stroke-width':1,'stroke-dasharray':'2 3',opacity:0}));
  }

  function openComponent(ref) {
    if(!run)return;
    selected=ref;board.select(ref);
    const f=parts[ref];
    const special={
      estimate:{title:'Sensor estimate',description:'What the sensor would report for this soil. After cooling ends, the simulated TH1 readings (14-bit ADC, 64 readings averaged, one sample per second) are baseline-corrected and fitted with the pulsed infinite-line-source model, as simple firmware would, using q′ = average heater power ÷ heated length and the nominal 8 mm spacing. The difference from the soil’s measured λ and C is the bias of this sensor and analysis, mostly from the finite heater length. Water content is then estimated from C with the de Vries relation θ = (C − ρb·cs)/Cw (cs = 0.75 MJ Mg⁻¹ K⁻¹, Cw = 4.18 MJ m⁻³ K⁻¹) and this core’s bulk density.'},
      model:{title:'About this simulation',description:'This dashboard follows the compact Nano-body r2 sensor through one measurement. The electrical model calculates current and power; the thermal model estimates how that heat spreads through uniform soil.'},
      thermal:{title:'Heated section, tip and surrounding soil',description:'The colormap shows temperature rise in ideal soil around the heater. Each location is calculated separately from the average power of the 17 resistors. It is not a prediction of the steel needle or resistor-chip temperature.'},
      logic:{title:'Logic circuits',description:'The controller, INA226 power monitor, thermistor dividers and supporting circuits share the logic rail after D7. Their combined current is assumed to be 10 mA throughout the cycle; individual chip consumption has not been measured.'},
      diodes:{title:'Supply diodes',description:'D1 protects the battery input and carries both heater and electronics current. D7 isolates the regulator output from USB and carries only the electronics current. Both dissipate current × forward voltage as heat.'},
      wiring:{title:'Cable & board copper',description:'Current heats the cable, connectors and copper traces as well as the heater resistors. These losses are included in battery draw, but are excluded from the modeled heat delivered by the 17 heater resistors.'}
    };
    const info=special[ref]||SensorComponents.getComponentInfo(ref,f);
    $('dialogRef').textContent=ref==='estimate'?'ANALYSIS':ref==='model'?'MODEL':ref==='thermal'?'HEAT TRANSFER':ref==='logic'?'U1 · U4 · SUPPORT':ref==='diodes'?'D1 · D7':ref==='wiring'?'INTERCONNECTS':ref;
    $('dialogTitle').textContent=info.title;
    $('dialogPart').textContent=f?(f.mpn||f.value)+(f.lcsc?' · '+f.lcsc:''):'Nano body r2 · 12 V · 17 × 3.3 Ω';
    $('dialogDescription').textContent=info.description;
    if(ref==='model')$('dialogExtra').innerHTML='<ul><li>Starting temperature: 22 °C. Uniform soil ('+esc(soil.label)+(soil.texture?', '+esc(soil.texture):'')+'): conductivity '+fmt(cfg.soilLambda,2)+' W/(m·K), heat capacity '+fmt(cfg.soilC/1e6,2)+' MJ/(m³·K); needle spacing 8 mm.</li><li>Soils in the Select soil dialog are single KD2 Pro SH-1 readings on Kansas Mesonet cores (0–50 cm; mostly silt loams and silty clay loams, no sands); the twin uses the selected reading’s measured λ and C. The KD2 Pro heats for 60 s, but λ and C are soil properties, so they apply to shorter pulses too. The same thermal model reproduces those 1,448 KD2 Pro curves with peaks about 4% high. See KANSAS_SOIL.md.</li><li>The curves and readings show the ideal thermal response. TH4 (board) is drawn but not reported, because board heating is not modeled. TH1 and TH3 overlap in symmetric soil.</li><li>Steel, epoxy, PCB heat storage, contact resistance, water flow and resistor body temperature are outside this model.</li><li>Electrical assumptions: 5 m one-way 22 AWG cable; no added contact resistance at the soldered cable pads; 0.2 Ω heater-loop copper; D1 drop 0.35 V; D7 drop 0.25 V; electronics current 10 mA.</li><li>The duty setting is fixed for the simulated pulse at 100 Hz: 85% gives about 1.99 W average at 12 V. This dashboard does not implement the proposed firmware regulation to a 2 W target as battery voltage changes. Heater highlights show average activity, not individual 100 Hz switching edges. Resistor limits are checked against ON power, not average power.</li><li>The proposed sample sequence enables Q2 for 10 ms settling and 10 ms acquisition every second. Component details include the last simulated ADC reading.</li><li>Before a run, the board stays neutral while the electronics still draw standby power. Starting or scrubbing a measurement enables neon yellow logic-power, pink signal, and orange heater-current highlights. Pausing freezes the displayed activity. Copper tabs show actual tracks, pads, vias and stored copper fills from the selected layer. The inner and bottom layers are viewed through the board to keep positions aligned. Logic and signal animation indicates activity, not decoded waveforms or electrical travel time. Heater and supply highlights pulse over real copper; shared ground fills are softly highlighted, without estimating current density or equal current in sensing branches. An unhighlighted heater trace can still have voltage when its switch is open. The Parts tab retains the simplified orange heater guide; component bodies are illustrative.</li><li>This is a simulation of the proposed sequence, not executable sensor firmware or a connection to hardware. Firmware still needs synchronized INA226 readings during settled ON windows, energy integration from actual ON time, and a forced LOW heater output at the deadline.</li></ul>';
    else if(ref==='thermal')$('dialogExtra').innerHTML='<p><strong>TH2 is 3.68 mm beyond the last heater resistor.</strong> Its small rise does not mean the entire heater needle has that temperature. The separate heated-section value samples ideal soil at the needle outer radius, beside the middle of the heater. Neither value predicts a thermocouple embedded in the heater.</p><p>The fixed purple → pink → orange → yellow scale spans 0–5 °C rise, with logarithmic spacing to keep small side-needle changes visible. Colors above 5 °C saturate. The needle interior is deliberately excluded. Colors disappear at baseline and fade as the soil cools; copper highlights separately show circuit activity.</p><p>Your recorded probe has heater-channel peaks around 60–63 °C and side-channel rises around 1.5 °C. Its construction manual specifies a 35–45 Ω wire heater; this revised PCB uses 56.1 Ω and adjustable PWM duty. A similar hot-needle temperature alone would not establish the side-needle signal or measurement accuracy. The logged heater-millivolt channel lacks the conversion needed to establish measured watts.</p><p>Steel, epoxy, PCB heat storage, contact resistance and water movement are not modeled. These curves do not establish that the manufactured sensor has enough heating margin. <a href="https://github.com/soilwater/heat-pulse/blob/main/flat-nano/HEATER_R2.md" target="_blank" rel="noopener">Read the revised heater design and qualification plan</a>.</p>';
    else if(/^RH\d+$/.test(ref))$('dialogExtra').innerHTML='<p>All 17 resistors are in series. During each ON interval, each releases <strong>I<sub>ON</sub>² × 3.3 Ω</strong>. Average heat is that ON power × duty / 100; energy accumulates as average power × elapsed heating time. Squaring the average current would give the wrong result. The selected Vishay part is rated 330 mW at up to 70 °C ambient, with derating above that temperature. Full-ON power is checked independently of duty. Its assembled chip temperature is not predicted by the soil colormap.</p>';
    else if(ref==='estimate')$('dialogExtra').innerHTML='<p>The de Vries step adds its own error: in this dataset measured C scatters about ±10% around ρb·cs + θ·Cw, so the θ comparison mixes sensor bias with that relation’s error. Flagged heat capacities (marked “!” in Select soil) can make it much larger. Noise, drift, contact resistance and needle deflection are not included.</p>';
    else if(ref==='logic')$('dialogExtra').innerHTML='<p>The displayed total is an estimate for the shared rail. No individual MCU or INA226 power is assigned. Sleep modes and transient loads are not modeled.</p>';
    else if(f)$('dialogExtra').innerHTML='<details><summary>Pad connections</summary><p>'+f.pads.filter(p=>p.net).map(p=>'Pin '+esc(p.pin)+' → '+esc(p.net)).join('<br>')+'</p></details>';
    else $('dialogExtra').innerHTML='';
    renderDialogValues();
    if(!dialog.open)dialog.showModal();
  }
  function renderDialogValues() {
    let entries=[];
    const e=run.electrical;
    if(selected==='estimate'){const {e,rows}=estimateRows();entries=e?[['Sensor λ',rows[0][1]+' W/(m·K) · '+rows[0][4]],['Soil λ (KD2 Pro)',rows[0][3]+' W/(m·K)'],['Sensor C',rows[1][1]+' MJ/(m³·K) · '+rows[1][4]],['Soil C (KD2 Pro)',rows[1][3]+' MJ/(m³·K)'],['Sensor θ',rows[2][1]+' m³/m³'],['Soil θ (measured)',rows[2][3]+' m³/m³']]:[['Estimate','Unavailable']];}
    else if(selected==='model')entries=[['Background',cfg.baselineS+' s'],['Heating',cfg.pulseS+' s'],['Cooling',cfg.cooldownS+' s'],['Cycle',duration+' s'],['Heater duty',cfg.dutyPct+'%'],['PWM frequency',cfg.pwmHz+' Hz'],['Soil',soil.label],['Soil properties',soilText(soil)]];
    else if(selected==='thermal')entries=[['Beside heated section',fmt(state.heatedZoneSoilC,2)+' °C'],['TH2 beyond heaters',fmt(state.temperaturesC[1],3)+' °C'],['Predicted side peak rise',fmt(Math.max(...run.series.map(p=>p.tempL))-cfg.ambientC,3)+' °C'],['Heater energy per pulse',fmt(e.heaterEnergyJ,2)+' J']];
    else if(/^RH\d+$/.test(selected)) {
      const heater=power.perHeaterW.find(p=>p.ref===selected);
      entries=[['Resistance',cfg.rEachOhm+' Ω'],['Average heat',watts(heater.powerW)],['Heat during ON',watts(heater.onPowerW)],['Current during ON',fmt(state.onCurrentA*1000,1)+' mA'],['Heater duty',state.dutyPct+'%'],['Average chain power',watts(power.heaterW)]];
    }
    else if(/^TH[1-4]$/.test(selected)) {
      const index=Number(selected.slice(2))-1,reading=state.readings.find(r=>r.ref===selected);
      entries=[['Simulated temperature',fmt(state.temperaturesC[index],3)+' °C'],['ADC input','A'+index],['Last simulated ADC',reading?fmt(reading.tempC,3)+' °C':'No sample yet'],['Excitation now',state.d4?'On · '+state.measurementPhase:'Off']];
    } else if(selected==='U1')entries=[['Cycle state',phaseName()[1]],['D9 · heater gate',gateCommand()],['D4 · excitation',state.d4?'HIGH':'LOW'],['Logic-rail power','Shared '+watts(power.logicRailW)]];
    else if(selected==='U3')entries=[['Heat dissipated',watts(power.U3dissipationW)],['Regulated output','5.0 V'],['After D7','4.75 V assumed'],['Electronics current','10 mA assumed']];
    else if(selected==='U4')entries=[['Current during ON',fmt(state.onCurrentA*1000,1)+' mA'],['Shunt voltage during ON',fmt(state.onCurrentA*cfg.shuntOhm*1000,3)+' mV'],['INA energy estimate',fmt(state.inaEnergyJ,3)+' J'],['Heater-only energy',fmt(state.energyJ,3)+' J']];
    else if(selected==='R5')entries=[['Resistance','0.1 Ω'],['Average power',watts(power.shuntW)],['Current during ON',fmt(state.onCurrentA*1000,1)+' mA'],['Voltage during ON',fmt(state.onCurrentA*.1*1000,3)+' mV']];
    else if(selected==='Q1')entries=[['D9 command',gateCommand()],['Switch',state.heaterOn?(cfg.dutyPct===100?'Closed':'Switching at '+cfg.pwmHz+' Hz'):'Open'],['Current during ON',fmt(state.onCurrentA*1000,1)+' mA'],['Average power',watts(power.mosfetW)]];
    else if(selected==='Q2')entries=[['D4 command',state.d4?'HIGH':'LOW'],['Sampling phase',state.measurementPhase],['VREF supply','Continuously powered'],['Read interval','1 s']];
    else if(selected==='D1'||selected==='D7')entries=[['Power now',watts(selected==='D1'?power.D1W:power.D7dissipationW)],['Assumed forward drop',selected==='D1'?'0.35 V':'0.25 V']];
    else if(selected==='logic')entries=[['Logic-rail power',watts(power.logicRailW)],['Aggregate current','10 mA assumed'],['Rail voltage','4.75 V assumed'],['Individual IC power','Not separately modeled']];
    else if(selected==='diodes')entries=[['D1 · battery path',watts(power.D1W)],['D7 · logic path',watts(power.D7dissipationW)]];
    else if(selected==='wiring')entries=[['Cable & connectors',watts(power.cableW)],['Heater-loop copper',watts(power.copperW)],['Cable','5 m one way · 22 AWG'],['Battery current',fmt(power.batteryCurrentA*1000,1)+' mA']];
    else if(parts[selected])entries=[['BOM value',parts[selected].bomValue||parts[selected].value],['Cycle state',phaseName()[1]]];
    $('dialogReadings').innerHTML=entries.map(([label,value])=>`<div class="dialog-reading"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
  }
  function frame(now) {
    const dt=lastFrame?Math.min(.25,(now-lastFrame)/1000):0;lastFrame=now;
    if(playing&&valid) {
      time=Math.min(duration,time+dt*speed);
      if(time>=duration)playing=false;
      if(now-lastPaint>45||!playing){render();lastPaint=now;}
    }
    requestAnimationFrame(frame);
  }

  $('timingForm').addEventListener('submit',event=>{event.preventDefault();applyTiming();});
  for(const key of settingKeys)$(key).addEventListener('change',applyTiming);
  // Modals: soil selection and the parts list. [data-close] buttons and backdrop clicks close them.
  for(const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click',event=>{if(event.target===d){const r=d.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)d.close();}});
    d.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>d.close()));
  }
  // Theme: dark (default) or light, saved per browser. Canvas/SVG colors that are not CSS-driven redraw.
  function setTheme(theme,save) {
    document.documentElement.dataset.theme=theme;
    $('themeToggle').setAttribute('aria-pressed',String(theme==='dark'));
    $('themeToggle').querySelector('.theme-text').textContent=theme==='dark'?'Dark':'Light';
    if(save)try{localStorage.setItem('hp-theme',theme);}catch(e){}
    board.refreshTheme&&board.refreshTheme();if(soilPicker)soilPicker.redraw();
    if(run)render();
  }
  $('themeToggle').addEventListener('click',()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark',true));
  const soilPicker=window.KansasSoil&&window.SoilPanel?SoilPanel.mount($('soilDialog'),window.KansasSoil,next=>{soil=next;applyTiming();},window.HPTwin):null;
  if(soilPicker)$('soilButton').addEventListener('click',()=>$('soilDialog').showModal());
  else $('soilButton').disabled=true;
  $('partsButton').addEventListener('click',()=>{buildPartsTable();$('partsDialog').showModal();});
  $('partsSummary').textContent=B.footprints.length+' parts · '+new Set(B.footprints.map(f=>f.mpn||f.ref)).size+' lines';
  function buildPartsTable() {
    if($('partsTable').rows.length)return;
    const groups=new Map();
    for(const f of B.footprints){const k=f.mpn||f.ref;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(f);}
    const natural=(a,b)=>a.localeCompare(b,undefined,{numeric:true});
    // Consecutive designators collapse into runs: C7–C9, C11, C21–C24.
    const refList=list=>{
      const r=list.map(f=>f.ref).sort(natural),num=x=>Number((x.match(/\d+$/)||[])[0]),stem=x=>x.replace(/\d+$/,''),runs=[];
      for(const x of r){const last=runs[runs.length-1];
        if(last&&stem(last[1])===stem(x)&&num(x)===num(last[1])+1)last[1]=x;else runs.push([x,x]);}
      return runs.map(([a,b])=>a===b?a:num(b)-num(a)===1?a+', '+b:a+'–'+b).join(', ');};
    const rows=[...groups.values()].sort((a,b)=>natural(a[0].ref,b[0].ref)).map(list=>{
      const f=list[0],info=SensorComponents.getComponentInfo(f.ref,f),mfr=SensorComponents.manufacturerOf(f.mpn);
      return '<tr><td><button data-part="'+esc(f.ref)+'">'+esc(refList(list))+'</button></td><td>'+esc(info.title)+'</td><td>'+esc(f.bomValue||f.value||'')+'</td><td>'+esc(mfr||'—')+'</td><td class="mono">'+esc(f.mpn||'—')+'</td><td class="mono">'+esc(f.lcsc||'—')+'</td><td class="desc">'+esc(f.description||'Bare solder pads, no part')+'</td></tr>';
    });
    $('partsTable').innerHTML='<thead><tr><th>Refs</th><th>Function</th><th>Value</th><th>Manufacturer</th><th>Part number</th><th>LCSC</th><th>Description</th></tr></thead><tbody>'+rows.join('')+'</tbody>';
    $('partsNote').textContent=B.footprints.length+' placed parts in '+rows.length+' lines, from the released BOM. Manufacturers are identified from part-number families (the BOM has no manufacturer column); a dash means not certain. Click a reference for its role and live values.';
    $('partsTable').addEventListener('click',event=>{const b=event.target.closest('[data-part]');if(!b)return;$('partsDialog').close();openComponent(b.dataset.part);});
  }
  $('start').addEventListener('click',()=>{
    if(!valid)return;
    if(time>=duration)time=0;
    started=true;playing=!playing;lastFrame=performance.now();render();
  });
  $('restart').addEventListener('click',reset);
  $('time').addEventListener('input',()=>{if(!valid)return;playing=false;started=true;time=Number($('time').value);render();});
  $('speed').addEventListener('click',()=>{speed={1:4,4:10,10:1}[speed];$('speed').textContent=speed+'×';$('speed').setAttribute('aria-label','Playback speed: '+speed+' times');});
  document.querySelectorAll('[data-component]').forEach(button=>{
    // SVG callouts already have pointer/keyboard handlers from SensorBoardView.
    if(button.namespaceURI!=='http://www.w3.org/2000/svg')button.addEventListener('click',()=>openComponent(button.dataset.component));
  });
  $('closeDialog').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{selected=null;board.select(null);});
  $('modelInfo').addEventListener('click',()=>openComponent('model'));
  $('modelNotes').addEventListener('click',()=>openComponent('model'));
  $('zoomIn').addEventListener('click',()=>board.zoomBy(1.5));
  $('zoomOut').addEventListener('click',()=>board.zoomBy(1/1.5));
  $('zoomFit').addEventListener('click',()=>board.resetView());
  const layerTabs=[...document.querySelectorAll('[data-board-view]')];
  function selectLayer(tab) {
    const layer=tab.dataset.boardView;
    board.setLayerView(layer);
    for(const button of layerTabs) {
      const selected=button===tab;
      button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
    }
    $('sensor-view').setAttribute('aria-labelledby',tab.id);
    $('layerNote').hidden=layer==='components';
    $('layerNote').textContent=({top:'Top · F.Cu',inner1:'In1 · GND plane',inner2:'In2 · +5 V plane',bottom:'Bottom · B.Cu'})[layer]+' · viewed from above';
  }
  for(const [index,tab] of layerTabs.entries()) {
    tab.addEventListener('click',()=>selectLayer(tab));
    tab.addEventListener('keydown',event=>{
      const next=event.key==='ArrowRight'?(index+1)%layerTabs.length:event.key==='ArrowLeft'?(index+layerTabs.length-1)%layerTabs.length:event.key==='Home'?0:event.key==='End'?layerTabs.length-1:null;
      if(next===null)return;
      event.preventDefault();layerTabs[next].focus();selectLayer(layerTabs[next]);
    });
  }
  $('board').addEventListener('boardzoom',event=>{
    const zoom=event.detail.zoom;
    $('zoomLevel').textContent=Math.round(zoom*100)+'%';
    $('zoomOut').disabled=zoom<=1.0001;
    $('zoomIn').disabled=zoom>=5.9999;
  });
  setTheme(document.documentElement.dataset.theme==='light'?'light':'dark',false);
  if(soilPicker)soilPicker.emit();else applyTiming();
  window.SensorTwin={get config(){return {...cfg};},get run(){return run;},get state(){return state;},
    get power(){return power;},get time(){return time;},get duration(){return duration;},get soil(){return {...soil};},get estimate(){return estimate;}};
  requestAnimationFrame(frame);
})();
