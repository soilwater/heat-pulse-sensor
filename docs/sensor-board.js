/* Actual exported PCB geometry and routed activity highlights. The component
 * view retains a simplified heater guide; copper views show exported geometry.
 * The quarter-turn is a rotation, not a reflection of the copper or component placement. */
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const node = (tag, attrs = {}, text) => {
    const e = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) e.setAttribute(key, value);
    if (text !== undefined) e.textContent = text;
    return e;
  };
  function mount(svg, board, onSelect) {
    const fit={x:-29,y:-24,w:76,h:Math.ceil(Math.max(...board.outline.flat().map(p=>p[0]))+40)};
    let view={...fit},zoom=1,gesture=null,suppressClick=false,layerView='components';
    function setLayerView(value) {
      if(!['components','top','inner1','inner2','bottom'].includes(value))return;
      layerView=value;svg.dataset.view=value;
      svg.setAttribute('aria-label',`${value==='components'?'Assembled PCB':({top:'Top copper',inner1:'Inner copper 1, ground plane',inner2:'Inner copper 2, +5 V plane',bottom:'Bottom copper'})[value]+', viewed from above through the board'}. Scroll to zoom, drag to pan, or select a component for details.`);
    }
    setLayerView(layerView);
    function drawView(announce=true) {
      view.x=Math.max(fit.x,Math.min(fit.x+fit.w-view.w,view.x));
      view.y=Math.max(fit.y,Math.min(fit.y+fit.h-view.h,view.y));
      svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);
      svg.classList.toggle('zoomed',zoom>1);
      if(announce)svg.dispatchEvent(new CustomEvent('boardzoom',{detail:{zoom}}));
    }
    function zoomBy(factor,anchor) {
      const next=Math.max(1,Math.min(6,zoom*factor));
      if(Math.abs(next-zoom)<1e-8)return;
      const point=anchor||{x:view.x+view.w/2,y:view.y+view.h/2};
      const fx=(point.x-view.x)/view.w,fy=(point.y-view.y)/view.h;
      zoom=next;view={x:point.x-fx*fit.w/zoom,y:point.y-fy*fit.h/zoom,w:fit.w/zoom,h:fit.h/zoom};
      drawView();
    }
    function resetView(){zoom=1;view={...fit};drawView();}
    svg.addEventListener('wheel',event=>{
      event.preventDefault();
      const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());
      const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?svg.clientHeight:1);
      zoomBy(Math.exp(-delta*.0015),point);
    },{passive:false});
    svg.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      suppressClick=false;
      const inverse=svg.getScreenCTM().inverse();
      gesture={id:event.pointerId,clientX:event.clientX,clientY:event.clientY,inverse,
        point:new DOMPoint(event.clientX,event.clientY).matrixTransform(inverse),view:{...view},moved:false};
    });
    svg.addEventListener('pointermove',event=>{
      if(!gesture||event.pointerId!==gesture.id)return;
      if(!gesture.moved&&Math.hypot(event.clientX-gesture.clientX,event.clientY-gesture.clientY)<4)return;
      gesture.moved=true;event.preventDefault();svg.setPointerCapture(event.pointerId);
      svg.classList.add('is-panning');
      const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(gesture.inverse);
      view.x=gesture.view.x-(point.x-gesture.point.x);view.y=gesture.view.y-(point.y-gesture.point.y);
      drawView(false);
    });
    const endGesture=event=>{
      if(!gesture||event.pointerId!==gesture.id)return;
      suppressClick=gesture.moved;gesture=null;svg.classList.remove('is-panning');
      if(svg.hasPointerCapture(event.pointerId))svg.releasePointerCapture(event.pointerId);
    };
    svg.addEventListener('pointerup',endGesture);svg.addEventListener('pointercancel',endGesture);
    svg.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopImmediatePropagation();suppressClick=false;}},true);
    drawView(false);
    const parts = Object.fromEntries(board.footprints.map(p => [p.ref, p]));
    const heaterRefs = Object.keys(parts).filter(ref=>/^RH\d+$/.test(ref)).sort((a,b)=>Number(a.slice(2))-Number(b.slice(2)));
    const lastHeater = heaterRefs[heaterRefs.length-1];
    const at = ref => parts[ref].xy;
    const pad = (ref, pin) => parts[ref].pads.find(p => p.pin === String(pin)).xy;
    const partEls = {}, flows = {}, copperPads=[], copperZones=[];
    const copperLayers=t=>(t.layers||(t.via?['top','bottom']:[t.layer])).join(' ');
    const polygonPath=polygons=>polygons.map(p=>[p.outer,...(p.holes||[])].map(ring=>
      ring.length?'M'+ring.map(p=>p.join(',')).join(' L')+' Z':'').join(' ')).join(' ');
    const heaterNets=['HEAT_P',...Array.from({length:heaterRefs.length-1},(_,i)=>'H_'+(i+1)),'HEAT_RTN'];
    const powerNets=['5V_LDO','+5V','VREF'],supplyNets=['VIN','VIN_P'];
    const gateNets=['D9_HEAT','HEAT_GATE'],excitationNets=['D4_EXC','EXC_GATE'];
    const busNets=['A4_SDA','A5_SCL'],senseNets=['TH_RTN','A0_TH1','A1_TH2','A2_TH3','A3_TH4'];
    // Drafting-sheet millimetre grid (1 mm minor, 5 mm major) behind the drawing.
    const defs=node('defs'),grid=node('pattern',{id:'mmGrid',width:5,height:5,patternUnits:'userSpaceOnUse'});
    for(let i=1;i<5;i++)grid.append(node('path',{d:`M${i},0 V5 M0,${i} H5`,class:'grid-minor'}));
    grid.append(node('path',{d:'M0,0 H5 M0,0 V5',class:'grid-major'}));defs.append(grid);svg.append(defs);
    svg.append(node('rect',{x:fit.x-60,y:fit.y-60,width:fit.w+120,height:fit.h+120,fill:'url(#mmGrid)',class:'drawing-grid','pointer-events':'none'}));
    const rotated = node('g', {transform:'translate(18 0) rotate(90)', id:'rotatedBoard'});
    svg.append(rotated);
    const heatmap=SensorHeatmap.mount(rotated,board);
    const edges=board.outline.map(e=>e.map(p=>p.slice())), first=edges.shift();
    let end=first[1], outline=`M${first[0]} L${end}`;
    const near=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<.01;
    while(edges.length) {
      const i=edges.findIndex(e=>near(e[0],end)||near(e[1],end));
      if(i<0)break;
      const e=edges.splice(i,1)[0];end=near(e[0],end)?e[1]:e[0];outline+=` L${end}`;
    }
    rotated.append(node('path', {d:outline+' Z', class:'board-outline'}));
    const zones=node('g',{class:'copper-detail copper-zones'});
    (board.zones||[]).forEach((zone,index)=>{
      const path=node('path',{d:polygonPath(zone.polygons),'fill-rule':'evenodd',class:'copper-zone',
        'data-zone-index':index,'data-net':zone.net,'data-copper-layers':zone.layer});
      path.append(node('title',{},`${zone.net} · ${zone.layer} copper fill`));
      zones.append(path);copperZones.push({element:path,net:zone.net});
    });
    rotated.append(zones);
    const copper=node('g', {class:'copper'});
    board.tracks.forEach((t,index)=>{
      const meta={'data-track-index':index,'data-net':t.net,'data-copper-layers':copperLayers(t)};
      copper.append(t.via
        ?node('circle', {...meta,cx:t.a[0],cy:t.a[1],r:t.width/2,fill:'#b6ac92'})
        :node('line', {...meta,x1:t.a[0],y1:t.a[1],x2:t.b[0],y2:t.b[1],stroke:t.layer==='top'?'#b6ac92':'#9b948b','stroke-width':t.width,'stroke-linecap':'round'}));
    });
    rotated.append(copper);
    const pads=node('g',{class:'copper-detail copper-pads'});
    for(const f of board.footprints)for(const [index,p] of f.pads.entries()) {
      const g=node('g',{class:'copper-pad','data-ref':f.ref,'data-pad-index':index,'data-pin':p.pin,
        'data-net':p.net,'data-copper-layers':(p.layers||[f.layer||'top']).join(' ')});
      selectable(g,f.ref);
      g.append(node('title',{},`${f.ref}.${p.pin} · ${p.net}`));
      for(const polygon of p.copperPolygons||[])g.append(node('path',{d:polygonPath([polygon]),
        'data-copper-layers':polygon.layer,'fill-rule':'evenodd',class:'copper-pad-shape'}));
      pads.append(g);copperPads.push({element:g,net:p.net,ref:f.ref});
    }
    rotated.append(pads);
    function flow(id, points, type) {
      const p=node('path', {id:'flow-'+id,d:points.map((p,i)=>(i?'L':'M')+p.join(',')).join(' '),class:'flow component-only '+type});
      flows[id]=p;rotated.append(p);
    }
    function routedFlow(id,nets,sources,type,activityOnly=false,copperOnly=false) {
      const group=node('g',{id:'flow-'+id,class:'flow '+type+(activityOnly?' activity-only':'')+(copperOnly?' copper-detail':'')});
      for(const track of SensorRoutes.buildRoute(board,{nets,sourcePads:sources})) {
        const meta={'data-track-index':track.index,'data-net':track.net,'data-layer':track.layer,'data-copper-layers':copperLayers(track)};
        if(track.via)group.append(node('circle',{...meta,cx:track.a[0],cy:track.a[1],r:track.width/2,class:'route-via'}));
        else {
          const [a,b]=track.direction===-1?[track.b,track.a]:[track.a,track.b];
          group.append(node('path',{...meta,d:`M${a} L${b}`,class:'route-segment'+(track.direction===0?' undirected':''),style:`--trace-width:${track.width}px`}));
        }
      }
      flows[id]=group;rotated.append(group);
    }
    flow('heat',[pad('J1',1),pad('D1',2),pad('D1',1),pad('R5',1),pad('R5',2),pad(heaterRefs[0],1),...heaterRefs.map(at)],'heater');
    flow('return',[at(lastHeater),[at(lastHeater)[0]+1,at(lastHeater)[1]+.65],[at('Q1')[0]+1,at(lastHeater)[1]+.65],pad('Q1',3),pad('Q1',2),pad('J1',3)],'heater');
    routedFlow('logic',['5V_LDO','+5V','VREF'],[{ref:'U3',pin:3},{ref:'D7',pin:1},{ref:'R11',pin:2}],'logic');
    routedFlow('gate',['D9_HEAT','HEAT_GATE'],[{ref:'U1',pin:29},{ref:'R9',pin:2}],'signal');
    routedFlow('excitation',['D4_EXC','EXC_GATE'],[{ref:'U1',pin:45},{ref:'R12',pin:2}],'signal');
    // I2C is bidirectional. Pulse actual copper rather than inventing bus traffic.
    routedFlow('i2c',['A4_SDA','A5_SCL'],[],'signal',true);
    routedFlow('thermistors',['TH_RTN','A0_TH1','A1_TH2','A2_TH3','A3_TH4'],[],'sense',true);
    // These nets include low-current sensing and protection branches. Pulse
    // the real copper without suggesting equal current or a direction in every branch.
    routedFlow('heaterTracks',heaterNets,[],'heater',true,true);
    routedFlow('supply',supplyNets,[],'logic',true,true);
    // Ground is shared. Indicate activity without inventing a path or current density.
    routedFlow('ground',['GND'],[],'logic',true,true);
    const drills=node('g',{class:'copper-detail copper-drills','pointer-events':'none'});
    for(const t of board.tracks)if(t.via&&t.drill>0)drills.append(node('circle',{
      cx:t.a[0],cy:t.a[1],r:t.drill/2,class:'copper-drill','data-copper-layers':(t.holeLayers||t.layers||board.copperLayers).join(' ')}));
    for(const f of board.footprints)for(const p of f.pads)if(p.holePolygons?.length)drills.append(node('path',{
      d:polygonPath(p.holePolygons),'fill-rule':'evenodd',class:'copper-drill',
      'data-copper-layers':(p.layers||['top','bottom']).join(' ')}));
    rotated.append(drills);
    function selectable(g,ref) {
      g.setAttribute('tabindex','0');g.setAttribute('role','button');
      g.setAttribute('aria-label',ref+' component details');
      g.addEventListener('click',()=>onSelect(ref));
      g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(ref);}});
    }
    for(const f of board.footprints) {
      const ref=f.ref,[x,y]=f.xy;
      const g=node('g', {id:'part-'+ref,class:'part'+(/^RH/.test(ref)?' heater-part':'')+(/^TH/.test(ref)?' ntc-part':'')});
      selectable(g,ref);g.append(node('title',{},ref+' · '+(f.mpn||f.value)));
      for(const p of f.pads) {
        g.append(node('rect',{x:p.xy[0]-p.size[0]/2,y:p.xy[1]-p.size[1]/2,width:p.size[0],height:p.size[1],rx:.04,class:'pad'}));
        if(p.drill[0]>0)g.append(node('circle',{cx:p.xy[0],cy:p.xy[1],r:p.drill[0]/2,fill:'#edf2ed'}));
      }
      let w=1,h=.55;
      if(ref==='U1'){w=10;h=10;}else if(ref==='U4'){w=3;h=3;}else if(ref==='U3'){w=2;h=4.4;}
      else if(ref==='J1'){w=2.4;h=10.4;}else if(ref.startsWith('Q')){w=1.4;h=2.8;}
      else if(ref.startsWith('D')){w=Math.abs(f.angle)===90?1.7:2.6;h=Math.abs(f.angle)===90?2.6:1.7;}
      else if(ref==='Y1'){w=1.5;h=3.2;}else if(ref==='R5'){w=1.25;h=1.8;}
      else if(/^RH\d+$/.test(ref)){w=1.6;h=.85;}
      else if(ref==='R18'||/^R2[1-4]$/.test(ref)){w=1.6;h=.8;}
      else if(['C1','C2','C17'].includes(ref)){w=2;h=1.25;}
      else if(Math.abs(f.angle)===90){w=.55;h=1;}
      if(!['J1','J2','J5'].includes(ref))g.append(node('rect',{x:x-w/2,y:y-h/2,width:w,height:h,rx:.1,class:'part-body'}));
      g.append(node('rect',{x:x-w/2-.14,y:y-h/2-.14,width:w+.28,height:h+.28,rx:0,fill:'none','vector-effect':'non-scaling-stroke',class:'part-outline'}));
      // Rotate labels back so the vertical drawing remains readable.
      if(ref!=='J1')g.append(node('text',{x,y,transform:`rotate(-90 ${x} ${y})`,class:'part-label',style:`font-size:${ref==='U1'?1.3:.59}px`},ref));
      if(ref==='U1')g.append(node('text',{x:x+1.8,y,transform:`rotate(-90 ${x+1.8} ${y})`,class:'part-label',style:'font-size:.8px'},'RA4M1'));
      g.append(node('rect',{x:x-Math.max(w,1.35)/2,y:y-Math.max(h,1.35)/2,width:Math.max(w,1.35),height:Math.max(h,1.35),fill:'transparent'}));
      partEls[ref]=g;rotated.append(g);
    }
    // Larger labels remain clickable at the full-board scale.
    // Two-line callouts: reference designator, then function.
    const tags=[['J1',-5,2.4,'J1','Cable pads'],['U3',24,10,'U3','Regulator'],['U1',-5,22.5,'U1','Controller'],
      ['U4',-5,33,'U4','Power monitor'],['Q1',24,42,'Q1','Heater switch'],['TH4',24,26,'TH4','Board temp.'],
      ['TH3',-5,73,'TH3','Right needle'],['TH1',24,73,'TH1','Left needle'],['RH11',24,62,'RH1–RH17','Heater, 17 × 3.3 Ω'],['TH2',24,98,'TH2','Heater tip']];
    for(const [ref,x,y,label,role] of tags) {
      const p=at(ref),px=18-p[1],py=p[0],right=x>18;
      const tag=node('g',{class:'board-tag', 'data-component':ref});selectable(tag,ref);
      tag.append(node('path',{d:`M${px},${py} L${right?21:-3},${py} L${right?21:-3},${y} L${x+(right?-.6:.6)},${y}`,class:'tag-line'}));
      tag.append(node('text',{x,y:y+.7,'text-anchor':right?'start':'end',class:'tag-label'},label));
      tag.append(node('text',{x,y:y+3.45,'text-anchor':right?'start':'end',class:'tag-role'},role));
      tag.append(node('rect',{x:right?x-.8:x-17,y:y-2,width:18,height:6,fill:'transparent'}));svg.append(tag);
    }
    SensorAnnotations.drawContext(svg,board);
    return {
      refreshTheme(){heatmap.refresh();},
      zoomBy,resetView,setLayerView,get layerView(){return layerView;},get zoom(){return zoom;},
      update(state,run,playing) {
        svg.classList.toggle('paused',!playing);
        // Standby still consumes power, but reserve automatic highlighting for a
        // measurement. Paused/scrubbed measurements keep their selected state.
        const showActivity=state.stage!=='idle';
        for(const [ref,g] of Object.entries(partEls))g.classList.toggle('active',showActivity&&state.activeRefs.includes(ref));
        const on=(id,value)=>flows[id].classList.toggle('on',showActivity&&!!value);
        on('heat',state.heaterOn);on('return',state.heaterOn);on('logic',state.logicValid);
        on('gate',state.d9);on('excitation',state.d4);
        on('i2c',['baseline','pulse','cooldown'].includes(state.stage));
        on('thermistors',state.d4);
        on('heaterTracks',state.heaterOn);on('supply',state.logicValid);on('ground',state.logicValid);
        for(const id of ['supply','ground']) {
          flows[id].classList.toggle('heater',state.heaterOn);
          flows[id].classList.toggle('logic',!state.heaterOn);
        }
        const activeNets=new Map();
        const mark=(nets,color)=>nets.forEach(net=>activeNets.set(net,color));
        if(showActivity) {
          if(state.logicValid){mark(powerNets,'power');mark([...supplyNets,'GND'],state.heaterOn?'heater':'power');}
          if(state.heaterOn)mark(heaterNets,'heater');
          if(state.d9)mark(gateNets,'signal');
          if(state.d4)mark([...excitationNets,...senseNets],'signal');
          if(['baseline','pulse','cooldown'].includes(state.stage))mark(busNets,'signal');
        }
        for(const {element,net} of [...copperPads,...copperZones]) {
          const color=activeNets.get(net);
          element.classList.toggle('energized',!!color);
          element.style.setProperty('--copper-active',color?`var(--flow-${color})`:'transparent');
        }
        heatmap.update(state,run);
      },
      select(ref) {
        for(const [r,g] of Object.entries(partEls))g.classList.toggle('selected',r===ref);
        for(const p of copperPads)p.element.classList.toggle('selected',p.ref===ref);
        svg.querySelectorAll('.board-tag').forEach(g=>g.classList.toggle('selected',g.dataset.component===ref));
      }
    };
  }
  window.SensorBoardView={mount};
})();
