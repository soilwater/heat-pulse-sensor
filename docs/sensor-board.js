/* Actual exported PCB geometry and routed activity highlights. Every activity
 * line follows exported copper (tracks and vias, never zones or invented chords).
 * The Parts view shows the heater path directed along its real 0.5 mm copper:
 * J1 middle hole, D1, the VIN_P feed inside the board on In2, R5, RH1-RH17, then
 * HEAT_RTN on bottom copper back to Q1. Branches that carry no heater current (the
 * U3, C1 and C18 buck input and the D2 surge path) are pruned as dead ends: each drawn
 * segment ends in a sink pad (D1, C3, R5, a heater resistor or Q1) or continues into
 * further drawn copper or a via. Inner-layer copper is otherwise hidden in
 * the Parts view, so that In2 feed is drawn there as a hatched guide. The copper
 * views pulse the heater and supply copper of the selected layer instead.
 * Part bodies are sized from each footprint's exported bodyBox.
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
    // A real reading powers the thermistors for only 20 ms each second, too short to see during playback.
    // Each reading is held on screen for 15% of the sample interval as played back (150 ms at 1x), and at
    // least one redraw, so it stays a quick pulse at every speed; between readings the copper stays dim pink.
    const READING_REFS=['R11','C13','R21','R22','R23','R24','C21','C22','C23','C24','TH1','TH2','TH3','TH4'];
    let lastSample=null,lastSampleAt=0,sampleGapMs=1000,flashUntil=0;
    function setLayerView(value) {
      if(!['components','top','inner1','inner2','bottom'].includes(value))return;
      layerView=value;svg.dataset.view=value;
      svg.setAttribute('aria-label',`${value==='components'?'Assembled PCB':({top:'Top copper',inner1:'Inner copper 1, ground plane',inner2:'Inner copper 2, +5 V plane and heater feed',bottom:'Bottom copper'})[value]+', viewed from above through the board'}. Scroll to zoom, drag to pan, or select a component for details.`);
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
    const partEls = {}, flows = {}, copperPads=[], copperZones=[];
    const copperLayers=t=>(t.layers||(t.via?['top','bottom']:[t.layer])).join(' ');
    const polygonPath=polygons=>polygons.map(p=>[p.outer,...(p.holes||[])].map(ring=>
      ring.length?'M'+ring.map(p=>p.join(',')).join(' L')+' Z':'').join(' ')).join(' ');
    const chainNets=Array.from({length:heaterRefs.length-1},(_,i)=>'H_'+(i+1));
    const heaterNets=['HEAT_P',...chainNets,'HEAT_RTN'];
    // U3 buck (SW, BOOT, VCC_BUCK, 5V_BUCK) through D7 to +5V; USB feeds +5V through D5 instead.
    const powerNets=['SW','BOOT','VCC_BUCK','5V_BUCK','+5V'],supplyNets=['VIN','VIN_P'],usbNets=['VUSB','VBUS_SENSE','+5V'];
    // Pin D4 HIGH powers VREF (divider tops and AREF) through R11; the thermistors return to GND.
    const gateNets=['D9_HEAT','HEAT_GATE'],excitationNets=['D4_EXC','VREF'];
    const busNets=['A4_SDA','A5_SCL'],senseNets=['A0_TH3','A1_TH2','A2_TH1','A3_TH4'];
    // Heater-current copper is at least 0.5 mm wide; narrower branches on these nets are sense taps.
    const HEATER_COPPER_MM=.5;
    // Drafting-sheet millimeter grid (1 mm minor, 5 mm major) behind the drawing.
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
    // Dead-end pruning for a directed route: repeatedly drop non-via segments whose
    // downstream end is not inside a sink pad and does not continue into another kept
    // segment (at its upstream end, part-way along it, or through a shared pad) or a via.
    // Undirected segments and vias are kept.
    const JOIN_MM=1e-3,sameXY=(p,q)=>Math.hypot(p[0]-q[0],p[1]-q[1])<=JOIN_MM;
    const inPad=(xy,pad)=>Math.abs(xy[0]-pad.xy[0])<=pad.size[0]/2+1e-8&&Math.abs(xy[1]-pad.xy[1])<=pad.size[1]/2+1e-8;
    const padLayers=(f,p)=>Array.isArray(p.layers)?p.layers:p.drill&&p.drill.some(v=>v>0)?['top','bottom']:[f.layer==='bottom'?'bottom':'top'];
    const drawnEnds=t=>t.direction===-1?[t.b,t.a]:[t.a,t.b];
    function onTrack(xy,t) {
      const [ax,ay]=t.a,dx=t.b[0]-ax,dy=t.b[1]-ay,l2=dx*dx+dy*dy;
      const k=l2?Math.max(0,Math.min(1,((xy[0]-ax)*dx+(xy[1]-ay)*dy)/l2)):0;
      return Math.hypot(ax+k*dx-xy[0],ay+k*dy-xy[1])<=JOIN_MM;
    }
    function pruneDeadEnds(tracks,sinks) {
      const sinkPads=sinks.map(({ref,pin})=>parts[ref]&&parts[ref].pads.find(p=>p.pin===String(pin))).filter(Boolean);
      const padsAt=(xy,net,layer)=>board.footprints.flatMap(f=>f.pads.filter(p=>p.net===net&&padLayers(f,p).includes(layer)&&inPad(xy,p)));
      const continues=(s,kept)=>{
        const to=drawnEnds(s)[1],shared=padsAt(to,s.net,s.layer);
        if(sinkPads.some(p=>p.net===s.net&&inPad(to,p)))return true;
        return kept.some(t=>t!==s&&t.net===s.net&&(t.via
          ?sameXY(t.a,to)&&(t.layers||['top','bottom']).includes(s.layer)
          :t.layer===s.layer&&((onTrack(to,t)&&(t.direction===0||!sameXY(to,drawnEnds(t)[1])))||
            (t.direction!==0&&shared.some(p=>inPad(drawnEnds(t)[0],p))))));
      };
      let kept=tracks,before;
      do{before=kept.length;const current=kept;kept=current.filter(s=>s.via||s.direction===0||continues(s,current));}
      while(kept.length<before);
      return kept;
    }
    // view: 'all' (Parts and copper views), 'copper' (copper views only) or
    // 'parts' (Parts view only). minWidth drops narrower segments (vias stay).
    // sinks: [{ref,pin}] pads where the drawn current ends; dead-end branches are pruned.
    function routedFlow(id,nets,sources,type,{activityOnly=false,view='all',minWidth=0,sinks=null}={}) {
      const group=node('g',{id:'flow-'+id,class:'flow '+type+(activityOnly?' activity-only':'')+
        (view==='copper'?' copper-detail':view==='parts'?' component-only':'')});
      let tracks=SensorRoutes.buildRoute(board,{nets,sourcePads:sources}).filter(t=>t.via||t.width>=minWidth-1e-6);
      if(sinks)tracks=pruneDeadEnds(tracks,sinks);
      for(const track of tracks) {
        const meta={'data-track-index':track.index,'data-net':track.net,'data-layer':track.layer,'data-copper-layers':copperLayers(track)};
        if(track.via)group.append(node('circle',{...meta,cx:track.a[0],cy:track.a[1],r:track.width/2,class:'route-via'}));
        else {
          const [a,b]=track.direction===-1?[track.b,track.a]:[track.a,track.b];
          const inner=view==='parts'&&!['top','bottom'].includes(track.layer);
          // The Parts view hides inner-layer copper; draw it hatched there, without
          // copper-layer tags, so the path stays continuous and reads as inside the board.
          if(inner)delete meta['data-copper-layers'];
          group.append(node('path',{...meta,d:`M${a} L${b}`,
            class:'route-segment'+(track.direction===0?' undirected':'')+(inner?' inner-layer-guide':''),
            style:`--trace-width:${track.width}px`+(inner?';stroke-dasharray:.22 .3;stroke-opacity:.6':'')}));
        }
      }
      flows[id]=group;rotated.append(group);
    }
    // Heater current in the Parts view. The return is drawn first because it runs
    // on bottom copper directly beneath the heater chain.
    // Sinks follow the current: J1.1 to D1 pin 2; D1 pin 1 through the VIN_P via and In2 strip
    // to R5 pin 1 (C3 pin 1 supplies the switching edges); R5 pin 2 on HEAT_P to RH1, then each
    // chain net into the next resistor's pin 1; HEAT_RTN from the last resistor to Q1 pin 3.
    routedFlow('return',['HEAT_RTN'],[{ref:lastHeater,pin:2}],'heater',{view:'parts',minWidth:HEATER_COPPER_MM,sinks:[{ref:'Q1',pin:3}]});
    routedFlow('heat',['VIN','VIN_P','HEAT_P',...chainNets],[{ref:'J1',pin:1},{ref:'D1',pin:1},{ref:'R5',pin:2},
      ...heaterRefs.slice(0,-1).map(ref=>({ref,pin:2}))],'heater',{view:'parts',minWidth:HEATER_COPPER_MM,
      sinks:[{ref:'D1',pin:2},{ref:'C3',pin:1},{ref:'R5',pin:1},...heaterRefs.map(ref=>({ref,pin:1}))]});
    routedFlow('logic',['SW','5V_BUCK','+5V'],[{ref:'U3',pin:5},{ref:'L1',pin:2},{ref:'D7',pin:1}],'logic');
    // USB power (J2 clip pin 1) through D5 to +5V; shown only in the USB-only case.
    routedFlow('usb',['VUSB','+5V'],[{ref:'J2',pin:1},{ref:'D5',pin:1}],'logic');
    routedFlow('gate',['D9_HEAT','HEAT_GATE'],[{ref:'U1',pin:29},{ref:'R9',pin:2}],'signal');
    routedFlow('excitation',excitationNets,[{ref:'U1',pin:45},{ref:'R11',pin:2}],'signal');
    // I2C is bidirectional. Pulse actual copper rather than inventing bus traffic.
    routedFlow('i2c',busNets,[],'signal',{activityOnly:true});
    routedFlow('thermistors',senseNets,[],'sense',{activityOnly:true});
    // These nets include low-current sensing and protection branches. Pulse
    // the real copper without suggesting equal current or a direction in every branch.
    routedFlow('heaterTracks',heaterNets,[],'heater',{activityOnly:true,view:'copper'});
    routedFlow('supply',supplyNets,[],'logic',{activityOnly:true,view:'copper'});
    // Ground is shared. Indicate activity without inventing a path or current density.
    routedFlow('ground',['GND'],[],'logic',{activityOnly:true,view:'copper'});
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
    // Package box from the export (fabrication outline, else courtyard, else pads).
    const bodyBox=f=>f.bodyBox||[Math.min(...f.pads.map(p=>p.xy[0]-p.size[0]/2)),Math.min(...f.pads.map(p=>p.xy[1]-p.size[1]/2)),
      Math.max(...f.pads.map(p=>p.xy[0]+p.size[0]/2)),Math.max(...f.pads.map(p=>p.xy[1]+p.size[1]/2))];
    // J1 (cable holes) and J2 (programming clip holes) have no package: outline and click area only.
    const bare=f=>f.bodySource!=='fab';
    for(const f of board.footprints) {
      const ref=f.ref,[x0,y0,x1,y1]=bodyBox(f),w=x1-x0,h=y1-y0,x=(x0+x1)/2,y=(y0+y1)/2;
      const g=node('g', {id:'part-'+ref,class:'part'+(/^RH/.test(ref)?' heater-part':'')+(/^TH/.test(ref)?' ntc-part':'')});
      selectable(g,ref);g.append(node('title',{},ref+' · '+(f.mpn||f.value)));
      for(const p of f.pads) {
        g.append(node('rect',{x:p.xy[0]-p.size[0]/2,y:p.xy[1]-p.size[1]/2,width:p.size[0],height:p.size[1],rx:.04,class:'pad'}));
        if(p.drill[0]>0)g.append(node('circle',{cx:p.xy[0],cy:p.xy[1],r:p.drill[0]/2,fill:'#edf2ed'}));
      }
      if(!bare(f))g.append(node('rect',{x:x0,y:y0,width:w,height:h,rx:Math.min(.1,w/4,h/4),class:'part-body'}));
      g.append(node('rect',{x:x0-.14,y:y0-.14,width:w+.28,height:h+.28,rx:0,fill:'none','vector-effect':'non-scaling-stroke',class:'part-outline'}));
      // Rotate labels back so the vertical drawing remains readable. Bare hole rows carry callout tags instead.
      if(!bare(f))g.append(node('text',{x,y,transform:`rotate(-90 ${x} ${y})`,class:'part-label',style:`font-size:${ref==='U1'?1.3:.59}px`},ref));
      if(ref==='U1')g.append(node('text',{x:x+1.8,y,transform:`rotate(-90 ${x+1.8} ${y})`,class:'part-label',style:'font-size:.8px'},'RA4M1'));
      g.append(node('rect',{x:x-Math.max(w,1.35)/2,y:y-Math.max(h,1.35)/2,width:Math.max(w,1.35),height:Math.max(h,1.35),fill:'transparent'}));
      partEls[ref]=g;rotated.append(g);
    }
    // Larger labels remain clickable at the full-board scale.
    // Two-line callouts: reference designator, then function. Portrait
    // coordinates (x'=18-y, y'=x). Tags on one side must keep their leader
    // spans (part row to tag row) disjoint so no two leaders share the column.
    const tags=[['J1',-5,2.4,'J1','Cable holes'],['U3',-5,10.5,'U3','5 V buck'],['U1',-5,23,'U1','Processor'],
      ['U4',-5,36,'U4','Power monitor'],['TH3',-5,73,'TH3','Left needle'],
      ['J2',24,13,'J2','Programming clip'],['Q1',24,30,'Q1','Heater switch'],['TH4',24,44,'TH4','Board temp.'],
      ['RH4',24,57,'RH1–RH17','Heater, 17 × 3.3 Ω'],['TH1',24,73,'TH1','Right needle'],['TH2',24,98,'TH2','Heater tip']];
    for(const [ref,x,y,label,role] of tags) {
      if(!parts[ref])continue;
      const right=x>18,[bx0,by0,bx1,by1]=bodyBox(parts[ref]);
      // Start at the body edge facing the tag, so leaders never cross the part's
      // own label or, for J1 and J2, run over a hole.
      const py=(bx0+bx1)/2,px=right?18-by0:18-by1;
      const tag=node('g',{class:'board-tag', 'data-component':ref});selectable(tag,ref);
      tag.append(node('path',{d:`M${px},${py} L${right?21:-3},${py} L${right?21:-3},${y} L${x+(right?-.6:.6)},${y}`,class:'tag-line'}));
      tag.append(node('text',{x,y:y+.7,'text-anchor':right?'start':'end',class:'tag-label'},label));
      tag.append(node('text',{x,y:y+3.45,'text-anchor':right?'start':'end',class:'tag-role'},role));
      tag.append(node('rect',{x:right?x-.8:x-17,y:y-2,width:18,height:6,fill:'transparent'}));svg.append(tag);
    }
    SensorAnnotations.drawContext(svg,board);
    // Camera: glide the view to frame a set of parts (used by guided tours; empty list = whole board).
    let flight=null;
    function flyTo(target,ms) {
      if(flight)cancelAnimationFrame(flight);
      const from={...view},start=performance.now();
      const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
      const step=now=>{
        const k=reduce||ms<=0?1:Math.min(1,(now-start)/ms),e=k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2;
        for(const key of ['x','y','w','h'])view[key]=from[key]+(target[key]-from[key])*e;
        zoom=fit.w/view.w;drawView(k===1);
        flight=k<1?requestAnimationFrame(step):null;
      };
      flight=requestAnimationFrame(step);
    }
    // include: optional CSS selector for drawing elements to frame with the parts (e.g. the cable wires).
    function focus(refs,{pad=3,maxZoom=8,ms=900,include=null}={}) {
      const els=[...(refs||[]).map(r=>partEls[r]).filter(Boolean),...(include?svg.querySelectorAll(include):[])];
      if(!els.length){flyTo({...fit},ms);return;}
      const inv=svg.getScreenCTM().inverse();let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
      for(const el of els){const b=el.getBoundingClientRect();
        for(const [cx,cy] of [[b.left,b.top],[b.right,b.bottom]]){const p=new DOMPoint(cx,cy).matrixTransform(inv);
          x0=Math.min(x0,p.x);y0=Math.min(y0,p.y);x1=Math.max(x1,p.x);y1=Math.max(y1,p.y);}}
      const z=Math.max(1,Math.min(maxZoom,fit.w/(x1-x0+2*pad),fit.h/(y1-y0+2*pad))),w=fit.w/z,h=fit.h/z;
      flyTo({x:(x0+x1)/2-w/2,y:(y0+y1)/2-h/2,w,h},ms);
    }
    function highlight(refs) {
      const set=new Set(refs||[]);
      svg.classList.toggle('tour-mode',!!refs);
      for(const [r,g] of Object.entries(partEls))g.classList.toggle('tour-focus',set.has(r));
    }
    return {
      focus,highlight,
      refreshTheme(){heatmap.refresh();},
      zoomBy,resetView,setLayerView,get layerView(){return layerView;},get zoom(){return zoom;},
      update(state,run,playing) {
        svg.classList.toggle('paused',!playing);
        // Standby still consumes power, but reserve automatic highlighting for a
        // measurement. Paused/scrubbed measurements keep their selected state.
        const showActivity=state.stage!=='idle';
        for(const [ref,g] of Object.entries(partEls))g.classList.toggle('active',showActivity&&state.activeRefs.includes(ref));
        const on=(id,value)=>flows[id].classList.toggle('on',showActivity&&!!value);
        // USB only: the clip's 5 V feeds +5V through D5; the battery, buck and heater supply are dead.
        const usbOnly=!!(run&&run.config&&run.config.fault==='usb-only');
        on('heat',state.heaterOn);on('return',state.heaterOn);
        on('logic',state.logicValid&&!usbOnly);on('usb',state.logicValid&&usbOnly);
        const sampling=state.logicValid&&['baseline','pulse','cooldown'].includes(state.stage);
        const sample=sampling&&state.sampleStartS!=null?state.sampleStartS:null,now=(typeof performance!=="undefined"?performance:Date).now();
        if(playing&&sample!==null&&sample!==lastSample){
          if(lastSample!==null)sampleGapMs=now-lastSampleAt;
          lastSampleAt=now;flashUntil=now+.15*sampleGapMs;
        }
        lastSample=playing?sample:null;
        const reading=showActivity&&(state.d4||(playing&&sample!==null&&now<flashUntil));
        for(const ref of READING_REFS)if(partEls[ref]&&reading)partEls[ref].classList.add('active');
        on('gate',state.d9);on('excitation',sampling);
        on('i2c',['baseline','pulse','cooldown'].includes(state.stage));
        on('thermistors',sampling);
        for(const id of ['excitation','thermistors']){flows[id].classList.toggle('reading',reading);flows[id].classList.toggle('sampling',sampling&&!reading);}
        on('heaterTracks',state.heaterOn);on('supply',state.logicValid&&!usbOnly);on('ground',state.logicValid);
        for(const id of ['supply','ground']) {
          flows[id].classList.toggle('heater',state.heaterOn);
          flows[id].classList.toggle('logic',!state.heaterOn);
        }
        const activeNets=new Map();
        const mark=(nets,color)=>nets.forEach(net=>activeNets.set(net,color));
        if(showActivity) {
          if(state.logicValid){
            mark(usbOnly?usbNets:powerNets,'power');
            mark(usbOnly?['GND']:[...supplyNets,'GND'],state.heaterOn?'heater':'power');
          }
          if(state.heaterOn)mark(heaterNets,'heater');
          if(state.d9)mark(gateNets,'signal');
          if(reading)mark([...excitationNets,...senseNets],'signal');
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
