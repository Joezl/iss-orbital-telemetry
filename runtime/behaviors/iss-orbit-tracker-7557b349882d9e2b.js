export default async function install(app) {
  app.assert(app.view?.type === '3d', 'ISS tracking needs a 3D scene.');
  const [GraphicsLayer, Graphic, Point, Polyline, Polygon] = await Promise.all([
    app.import('esri/layers/GraphicsLayer'), app.import('esri/Graphic'),
    app.import('esri/geometry/Point'), app.import('esri/geometry/Polyline'),
    app.import('esri/geometry/Polygon')
  ]);
  const [Glow,BaseElevationLayer]=await Promise.all([app.import('esri/webscene/Glow'),app.import('esri/layers/BaseElevationLayer')]);
  const previousGlow=app.view.environment.lighting?.glow?.clone()||null;
  if(app.view.environment.lighting?.type==='sun')app.view.environment.lighting.glow=new Glow({intensity:0.2});
  const liveLayer = app.layers[app.config.liveLayerId];
  const archive = app.layers[app.config.archiveLayerId];
  app.assert(liveLayer && archive, 'ISS telemetry source layers are missing.');
  liveLayer.visible = false;
  archive.visible = false;
  const mkLayer = (id, title, elevationInfo) => {
    const layer = new GraphicsLayer({id, title, elevationInfo, listMode:'hide'});
    app.map.add(layer); return layer;
  };
  const model = mkLayer('iss-live-model', 'ISS / NASA 3D model (scaled)', {mode:'absolute-height'});
  const tether = mkLayer('iss-nadir', 'ISS / ground reference', {mode:'absolute-height'});
  const trail = mkLayer('iss-24h-trail', 'ISS / fading 24h orbital history', {mode:'absolute-height'});
  const nightShade = mkLayer('iss-night-shade', 'ISS / readable night-side solar shading', {mode:'on-the-ground'});
  const ground = mkLayer('iss-ground-projection', 'ISS / terrain-clamped shadow and coordinates', {mode:'on-the-ground'});
  const WGS = {wkid:4326};
  const altitude = Number(app.config.nominalAltitudeKm) * 1000;
  const point = (lon,lat,z) => new Point({longitude:lon,latitude:lat,z,spatialReference:WGS});
  const groundPoint=(lon,lat)=>new Point({longitude:lon,latitude:lat,spatialReference:WGS});
  // NASA 3D Resources, International Space Station (ISS) (B), glTF binary.
  // Scaled deliberately for visibility from a 4,200 km camera: not physical size.
  const nasaModel='https://assets.science.nasa.gov/content/dam/science/cds/3d/resources/model/international-space-station-(iss)-(b)/International%20Space%20Station%20(ISS)%20(B).glb';
  const station = [new Graphic({symbol:{type:'point-3d',symbolLayers:[{type:'object',resource:{href:nasaModel},height:90000,heading:90,castShadows:false,material:{color:'#ffffff',emissive:{source:'color',strength:0.32}}}]}})];
  model.addMany(station);
  const line = new Graphic({symbol:{type:'simple-line',color:[71,233,224,0.65],width:1.6,style:'dash'}});
  tether.add(line);
  const shadow = new Graphic({symbol:{type:'point-3d',symbolLayers:[{type:'icon',resource:{primitive:'circle'},material:{color:[104,111,119,0.46]},outline:{color:[170,180,189,0.67],size:1},size:18}]}});
  const groundLabel = new Graphic({symbol:{type:'text',text:'',color:'#d6fbf7',haloColor:'#071622',haloSize:2,font:{family:'Menlo',size:11,weight:'bold'},yoffset:29}});
  ground.addMany([shadow,groundLabel]);
  // A dynamic final segment keeps the plotted history attached to the station
  // between archive polls and shaded-history redraws.
  const tailLink=new Graphic({symbol:{type:'simple-line',style:'solid',color:[47,230,222,.96],width:2.7}});
  // Render the moving tip in the same GraphicsLayer as the model, so its
  // geometry updates with the station instead of racing a second layer redraw.
  model.add(tailLink);
  const cameraControls=app.view.ui.getComponents().filter(c=>['esri.widgets.NavigationToggle','esri.widgets.Compass','esri.widgets.Zoom'].includes(c.declaredClass));
  cameraControls.forEach(c=>app.view.ui.move(c,'top-right'));
  const mount = app.getMount('iss-controls');
  const root = document.createElement('div');
  root.style.cssText='display:grid;gap:8px;padding:2px;min-width:0;color:var(--app-text)';
  const heading = document.createElement('div');
  heading.style.cssText='font-size:11px;letter-spacing:.13em;color:var(--app-accent)';
  heading.textContent='ISS POSITION';
  const coords = document.createElement('div');
  coords.style.cssText='font-size:19px;font-weight:700;line-height:1.5;overflow-wrap:anywhere';
  coords.textContent='Awaiting position…';
  const stamp = document.createElement('div'); stamp.style.color='var(--app-text-muted)';stamp.style.fontSize='11px';
  const state = document.createElement('div'); state.style.cssText='font-size:11px;color:var(--app-text-muted)';state.textContent='Connecting…';
  const rule = document.createElement('div');rule.style.cssText='height:1px;background:var(--app-border);margin:3px 0';
  const section = document.createElement('div'); section.style.cssText='font-size:11px;letter-spacing:.12em;color:var(--app-accent)';section.textContent='REPLAY · LOADING HISTORY';
  const slider = document.createElement('calcite-slider');
  slider.setAttribute('label','Replay time');
  slider.setAttribute('min','0');slider.setAttribute('max','1');slider.setAttribute('step','0.1');slider.value=1;
  const range = document.createElement('div');range.style.cssText='display:flex;justify-content:space-between;font-size:11px;color:var(--app-text-muted)';
  const left = document.createElement('span');left.textContent='Waiting for data';const right=document.createElement('span');right.textContent='LATEST';range.append(left,right);
  const time = document.createElement('div');time.style.cssText='font-size:12px;color:var(--app-text-muted)';time.textContent='Loading history…';
  const buttons = document.createElement('div');buttons.style.cssText='display:flex;align-items:center;gap:6px;min-width:0';
  const play = document.createElement('calcite-button');play.setAttribute('icon-start','play');play.setAttribute('appearance','outline');play.setAttribute('scale','m');play.setAttribute('aria-label','Play replay');play.setAttribute('title','Play replay');play.style.cssText='flex:none';play.textContent='';
  slider.style.cssText='flex:1;min-width:0';buttons.append(slider,play);
  const speedControl=document.createElement('calcite-segmented-control');
  speedControl.setAttribute('scale','s');speedControl.setAttribute('aria-label','Replay speed');
  for(const n of [1,2,4]){const item=document.createElement('calcite-segmented-control-item');item.setAttribute('value',String(n));item.textContent=`${n}×`;if(n===2)item.setAttribute('checked','');speedControl.append(item);}
  const speedRow=document.createElement('div');speedRow.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:var(--app-text-muted)';
  const speedLabel=document.createElement('span');speedLabel.textContent='SPEED';speedRow.append(speedLabel,speedControl);
  const liveButton = document.createElement('calcite-button');liveButton.setAttribute('icon-start','satellite-1');liveButton.setAttribute('scale','l');liveButton.style.cssText='width:100%;font-weight:700';liveButton.textContent='Live view';
  root.append(coords,stamp,liveButton,section,buttons,range,speedRow,time);mount.replaceChildren(root);
  let samples=[], live=null, mode='live', playing=false, cursor=1, replaySpeed=2, disposed=false, lastCamera=0, lastArchive=0, busy=false, liveFollowing=true;
  // An understated border glow lives on the control only; no extra label or dot.
  const liveGlow=matchMedia('(prefers-reduced-motion: reduce)').matches?null:liveButton.animate([
    {boxShadow:'inset 0 0 0 1px var(--app-accent)'},
    {boxShadow:'inset 0 0 0 2px var(--app-accent), 0 0 9px var(--app-accent)'}
  ],{duration:2400,direction:'alternate',iterations:Infinity,easing:'ease-in-out'});
  const updateLiveButton=()=>{
    liveButton.textContent='Live view';
    liveButton.setAttribute('appearance',mode==='live'&&liveFollowing?'solid':'outline');
    liveButton.setAttribute('title',mode==='live'?(liveFollowing?'Following ISS · move globe to pause':'Click to follow ISS again'):'Return to live ISS position');
    liveButton.setAttribute('aria-label',mode==='live'?(liveFollowing?'Live view, following ISS':'Live view, free view; click to follow ISS'):'Return to live view');
    if(liveGlow){if(mode==='live'&&liveFollowing)liveGlow.play();else liveGlow.pause();}
    else liveButton.style.boxShadow=mode==='live'&&liveFollowing?'inset 0 0 0 1px var(--app-accent)':'';
  };
  updateLiveButton();
  // Manual navigation suspends tracking until Live view is pressed again.
  const stopFollowing=()=>{if(mode==='live'&&liveFollowing){liveFollowing=false;app.view.animation?.stop();updateLiveButton();}};
  const sceneInput=app.view.container;
  sceneInput.addEventListener('pointerdown',stopFollowing,true);
  sceneInput.addEventListener('wheel',stopFollowing,{capture:true,passive:true});
  sceneInput.addEventListener('keydown',stopFollowing,true);
  const replayStart=()=>samples[0]?.t??0;
  const replayEnd=()=>samples.at(-1)?.t??0;
  const replayMinutes=()=>samples.length>1?Math.max(0.1,(replayEnd()-replayStart())/60000):1;
  const syncCursor=()=>{cursor=mode==='live'?replayMinutes():Math.max(0,Math.min(replayMinutes(),(replayTime-replayStart())/60000));slider.value=cursor;};
  const updateReplayRange=()=>{const minutes=replayMinutes();slider.max=minutes;slider.disabled=samples.length<2;section.textContent=samples.length>1?`REPLAY · ${minutes>=120?(minutes/60).toFixed(1)+' H':Math.round(minutes)+' MIN'} AVAILABLE`:'REPLAY · NO HISTORY';left.textContent=samples.length>1?new Date(replayStart()).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'No history';right.textContent=samples.length>1?'LATEST '+new Date(replayEnd()).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'LATEST';syncCursor();};
  let frame=0, lastDraw=0, lastLabel=0, replayTime=0, replayClock=0, cameraMode='', shown=null;
  // The agreed Live chase framing; Replay has its own global framing.
  const liveScale=5768591, liveHeading=24.495, liveTilt=50.87;
  let lastGroundText='', lastTrailEnd=0, trailRefreshes=0;
  let lastGroundLabelAt=0, groundLabelUpdates=0, lastGroundLabelMode='';
  let smoothFix=null, lastLiveTarget=0;
  const originalSky={atmosphereEnabled:app.view.environment.atmosphereEnabled,starsEnabled:app.view.environment.starsEnabled,lighting:app.view.environment.lighting?.clone()};
  const sceneContainer=app.view.container;
  const originalPadding={...app.view.padding};
  const previousSceneFilter=sceneContainer.style.filter;
  const previousFilterTransition=sceneContainer.style.transition;
  const sceneGround=app.map.ground, originalGroundLayers=sceneGround.layers.toArray();
  const originalGroundOpacity=sceneGround.opacity;
  const elevationSource=originalGroundLayers[0];
  app.assert(elevationSource&&typeof elevationSource.fetchTile==='function','The scene needs an elevation tile source for 10× terrain.');
  const ExaggeratedElevation=BaseElevationLayer.createSubclass({
    fetchTile:async function(level,row,col,options){
      const data=await elevationSource.fetchTile(level,row,col,options);
      const values=new Float32Array(data.values.length);
      for(let i=0;i<values.length;i++){
        const height=data.values[i];values[i]=height===data.noDataValue?height:height*10;
      }
      return {values,width:data.width,height:data.height,noDataValue:data.noDataValue};
    }
  });
  const exaggeratedElevation=new ExaggeratedElevation({id:'iss-live-10x-elevation',title:'ISS / live terrain 10×'});
  const setTerrainMode=liveMode=>{
    if(liveMode){sceneGround.opacity=originalGroundOpacity;sceneGround.layers=[exaggeratedElevation];}
    else {sceneGround.layers=originalGroundLayers;sceneGround.opacity=0.5;}
    groundLabel.visible=liveMode;
  };
  // The SDK cannot add ambient light to a sun-lit night hemisphere. Keep the
  // imagery readable using virtual light and draw a time-accurate, translucent
  // night-side overlay. This is visual solar shading, not physical sun lighting.
  const setReplaySky=()=>{app.view.padding=originalPadding;setTerrainMode(false);nightShade.visible=false;sceneContainer.style.filter=previousSceneFilter;app.view.environment.atmosphereEnabled=false;app.view.environment.starsEnabled=false;app.view.environment.lighting={type:'virtual'};};
  const setLiveSky=()=>{app.view.padding={top:0,right:0,bottom:0,left:0};setTerrainMode(true);app.view.environment.atmosphereEnabled=originalSky.atmosphereEnabled;app.view.environment.starsEnabled=originalSky.starsEnabled;app.view.environment.lighting={type:'virtual'};nightShade.visible=true;updateNightShade();};
  let nightLight=false;
  // Virtual light reveals imagery in Earth's shadow, while daylight keeps the
  // original sun lighting. The SDK has no independent night-side ambient slider.
  const sunBelowHorizon=(p,t=Date.now())=>{
    if(!p)return false;
    const d=new Date(t), start=Date.UTC(d.getUTCFullYear(),0,1), day=(t-start)/86400000;
    const gamma=2*Math.PI/365*(day+(d.getUTCHours()-12)/24);
    const eq=229.18*(0.000075+0.001868*Math.cos(gamma)-0.032077*Math.sin(gamma)-0.014615*Math.cos(2*gamma)-0.040849*Math.sin(2*gamma));
    const dec=0.006918-0.399912*Math.cos(gamma)+0.070257*Math.sin(gamma)-0.006758*Math.cos(2*gamma)+0.000907*Math.sin(2*gamma)-0.002697*Math.cos(3*gamma)+0.00148*Math.sin(3*gamma);
    const minutes=d.getUTCHours()*60+d.getUTCMinutes()+d.getUTCSeconds()/60;
    const angle=((minutes+eq+4*p.lon)%1440+1440)%1440/4-180;
    const lat=p.lat*Math.PI/180;
    const sinAltitude=Math.sin(lat)*Math.sin(dec)+Math.cos(lat)*Math.cos(dec)*Math.cos(angle*Math.PI/180);
    return sinAltitude<(nightLight?0:-0.10);
  };
  let lastNightShade=0;
  const updateNightShade=()=>{
    const t=Date.now();if(t-lastNightShade<60000)return;lastNightShade=t;
    const d=new Date(t),day=(t-Date.UTC(d.getUTCFullYear(),0,1))/86400000;
    const gamma=2*Math.PI/365*(day+(d.getUTCHours()-12)/24);
    const eq=229.18*(0.000075+0.001868*Math.cos(gamma)-0.032077*Math.sin(gamma)-0.014615*Math.cos(2*gamma)-0.040849*Math.sin(2*gamma));
    const dec=0.006918-0.399912*Math.cos(gamma)+0.070257*Math.sin(gamma)-0.006758*Math.cos(2*gamma)+0.000907*Math.sin(2*gamma)-0.002697*Math.cos(3*gamma)+0.00148*Math.sin(3*gamma);
    const minute=d.getUTCHours()*60+d.getUTCMinutes()+d.getUTCSeconds()/60;
    const sunLon=((180-(minute+eq)/4+540)%360)-180;
    const sx=Math.cos(dec)*Math.cos(sunLon*Math.PI/180),sy=Math.cos(dec)*Math.sin(sunLon*Math.PI/180),sz=Math.sin(dec);
    const cells=[];
    // Small terrain-clamped geographic patches cannot span the date line.
    // Dusk fades in over ~12 degrees; deep night retains 62% of imagery.
    for(let lat=-87.5;lat<=87.5;lat+=5){
      const phi=lat*Math.PI/180,cp=Math.cos(phi),sp=Math.sin(phi);
      for(let lon=-177.5;lon<=177.5;lon+=5){
        const lambda=lon*Math.PI/180;
        const solar=cp*Math.cos(lambda)*sx+cp*Math.sin(lambda)*sy+sp*sz;
        if(solar>=0.12)continue;
        const fade=Math.min(1,Math.max(0,(0.12-solar)/0.22));
        const alpha=0.38*fade;
        cells.push(new Graphic({geometry:new Polygon({rings:[[[lon-2.5,lat-2.5],[lon-2.5,lat+2.5],[lon+2.5,lat+2.5],[lon+2.5,lat-2.5],[lon-2.5,lat-2.5]]],spatialReference:WGS}),symbol:{type:'simple-fill',color:[5,13,33,alpha],outline:{color:[5,13,33,0],width:0}}}));
      }
    }
    nightShade.removeAll();nightShade.addMany(cells);
  };
  const syncLiveLighting=p=>{if(mode==='live')updateNightShade();};
  const setSkyTime=t=>{if(Number.isFinite(t)&&mode==='live'&&app.view.environment.lighting?.type==='sun')app.view.environment.lighting.date=new Date(t);};
  const wrap=x=>((x+180)%360+360)%360-180;
  const interpolate=(a,b,t)=>{
    if(!a||!b||b.t<=a.t)return a||b;
    const f=Math.max(0,Math.min(1,(t-a.t)/(b.t-a.t)));
    return {lat:a.lat+(b.lat-a.lat)*f,lon:wrap(a.lon+wrap(b.lon-a.lon)*f),t};
  };
  const atTime=t=>{
    if(!samples.length||t<samples[0].t)return null;
    let lo=0,hi=samples.length-1;
    while(lo<hi){const mid=(lo+hi+1)>>1;if(samples[mid].t<=t)lo=mid;else hi=mid-1;}
    const a=samples[lo], b=samples[lo+1];
    if(!b||b.t-a.t>15*60000)return a;
    return interpolate(a,b,t);
  };
  const livePosition=()=>{
    if(!samples.length)return live;
    // Keep the displayed position on the observed path. Never advance the
    // history into a new fix before the station actually reaches that fix.
    const latest=samples.at(-1);
    const targetTime=Math.min(latest.t,Date.now()-60000);
    return atTime(Math.max(samples[0].t,targetTime))||latest;
  };
  const moveCamera=(p,globe=false,force=false)=>{
    if(!p)return;
    const now=Date.now(), changed=cameraMode!==(globe?'globe':'follow');
    if(!globe&&mode==='live'&&!liveFollowing&&!force)return;
    if(!force&&!changed&&now-lastCamera<(globe?4500:mode==='live'?1000:3600))return;
    lastCamera=now;cameraMode=globe?'globe':'follow';
    const target=point(p.lon,p.lat,globe?0:altitude);
    // Keep the model as the camera target at the agreed angle/distance.
    // Follow steps are instantaneous: repeating an eased zoom pulsed the Earth.
    const liveStep=mode==='live'&&!globe&&!changed&&!force;
    void app.view.goTo({target,heading:globe?25:liveHeading,tilt:globe?10:liveTilt,scale:globe?145000000:liveScale},
      {animate:!liveStep,duration:changed?2400:globe?4400:3400}).catch(()=>{});
  };
  const fmt = p => `${Math.abs(p.lat).toFixed(3)}°${p.lat>=0?'N':'S'}  /  ${Math.abs(p.lon).toFixed(3)}°${p.lon>=0?'E':'W'}`;
  const parse = f => {
    const a=f.attributes||{}, g=f.geometry;
    const lat=Number(a.Latitude ?? g?.latitude ?? g?.y), lon=Number(a.Longitude ?? g?.longitude ?? g?.x);
    const value=a.Datum ?? a.TextDateTime;
    const t=typeof value==='number'?value:Date.parse(String(value||''));
    return Number.isFinite(lat)&&Number.isFinite(lon)?{lat,lon,t:Number.isFinite(t)?t:Date.now()}:null;
  };
  const place = (p, fly=false) => {
    station[0].geometry=point(p.lon,p.lat,altitude);
    line.geometry=new Polyline({paths:[[[p.lon,p.lat,3000],[p.lon,p.lat,altitude]]],spatialReference:WGS,hasZ:true});
    shadow.geometry=groundPoint(p.lon,p.lat);
    const text=fmt(p);
    // Keep the map label mounted and still between sampled captions. Repositioning
    // and re-typesetting text at animation frequency made it flash in SceneView.
    const now=performance.now(), captionInterval=mode==='live'?30000:15000;
    if(!lastGroundLabelAt||lastGroundLabelMode!==mode||now-lastGroundLabelAt>=captionInterval){
      lastGroundLabelAt=now;lastGroundLabelMode=mode;groundLabelUpdates++;
      groundLabel.geometry=groundPoint(p.lon,p.lat);
      if(text!==lastGroundText){lastGroundText=text;
        groundLabel.symbol={type:'text',text:`NADIR  ${text}`,color:'#d6fbf7',haloColor:'#071622',haloSize:2,font:{family:'Menlo',size:11,weight:'bold'},yoffset:29};
      }
    }
    if(coords.textContent!==text)coords.textContent=text;
    if(fly)moveCamera(p,false);
  };
  const drawTrail = (end) => {
    if(samples.length<2)return;
    const start=end-86400000;
    let candidates=samples.filter(p=>p.t>=start&&p.t<=end);
    const tail=atTime(end);
    if(tail&&candidates.length&&tail.t>candidates.at(-1).t&&tail.t-candidates.at(-1).t<15*60000)candidates.push(tail);
    if(candidates.length<2)return;
    // Draw continuous strokes, not a separate graphic for every observed fix.
    // At most 64 gently shaded strokes span the observed portion of the 24-hour window.
    const origin=candidates[0].t, span=Math.max(1,candidates.at(-1).t-origin);
    const strokes=[];let path=null, band=-1;
    const flush=()=>{
      if(!path||path.length<2)return;
      const progress=Math.min(1,Math.max(0,(band+.5)/64));
      const eased=progress*progress*(3-2*progress);
      strokes.push(new Graphic({
        geometry:new Polyline({paths:[path],spatialReference:WGS,hasZ:true}),
        symbol:{type:'simple-line',style:'solid',cap:'butt',join:'round',color:[47,230,222,.09+.87*eased],width:2.7}
      }));
    };
    for(let i=1;i<candidates.length;i++){
      const a=candidates[i-1],b=candidates[i];
      if(b.t-a.t>15*60000||Math.abs(b.lon-a.lon)>90){flush();path=null;band=-1;continue;}
      const nextBand=Math.min(63,Math.floor(64*((a.t+b.t)/2-origin)/span));
      if(nextBand!==band){if(path)path.push([a.lon,a.lat,altitude]);flush();path=null;band=nextBand;}
      if(!path)path=[[a.lon,a.lat,altitude]];
      path.push([b.lon,b.lat,altitude]);
    }
    flush();
    // Keep previously rendered strokes mounted while updating. Clearing the layer
    // before adding replacements made the orbit visibly blink during playback.
    const existing=trail.graphics.toArray().filter(g=>g!==tailLink);
    const added=[];
    strokes.forEach((stroke,i)=>{
      if(existing[i]){
        existing[i].geometry=stroke.geometry;
        if(existing[i].symbol.color.toJSON()[3]!==stroke.symbol.color.toJSON()[3])existing[i].symbol=stroke.symbol;
      }else added.push(stroke);
    });
    if(added.length)trail.addMany(added);
    if(existing.length>strokes.length)trail.removeMany(existing.slice(strokes.length));
    lastTrailEnd=candidates.at(-1).t;trailRefreshes++;
  };
  const connectTail=p=>{
    const anchor=atTime(lastTrailEnd)||(mode==='replay'?samples[0]:null),tip=station[0].geometry;
    if(!p||!tip||!anchor||p.t<anchor.t){tailLink.visible=false;return;}
    // The history is rebuilt less often than the model moves. Bridge observed
    // fixes since that redraw and end at the model's exact geometry each frame.
    const between=samples.filter(s=>s.t>lastTrailEnd&&s.t<p.t);
    const vertices=[anchor,...between,{lon:tip.x,lat:tip.y,t:p.t}];
    let path=[[anchor.lon,anchor.lat,altitude]];
    for(let i=1;i<vertices.length;i++){
      const a=vertices[i-1],b=vertices[i];
      if(b.t-a.t>15*60000||Math.abs(b.lon-a.lon)>90)path=[];
      path.push([b.lon,b.lat,altitude]);
    }
    // A data gap or date-line crossing never becomes a false shortcut.
    tailLink.visible=path.length>1;
    if(tailLink.visible)tailLink.geometry=new Polyline({paths:[path],spatialReference:WGS,hasZ:true});
  };
  const show = () => {
    time.style.display=mode==='live'?'none':'';
    if(mode==='live'){
      if(live){const p=shown||livePosition()||live;if(!shown){place(p);shown=p;}syncLiveLighting(p);drawTrail(Math.min(p.t,samples.at(-2)?.t??p.t));connectTail(p);time.textContent='Live · '+new Date(p.t).toLocaleTimeString();}
      return;
    }
    const target=replayTime||replayStart()+cursor*60000;
    const p=atTime(target);
    if(p){place(p);shown=p;setSkyTime(target);time.textContent='Replay · '+new Date(target).toLocaleString();}
    else time.textContent='No history here';
    drawTrail(target);if(p)connectTail(p);else tailLink.visible=false;
  };
  const refresh = async () => {
    if(busy||disposed)return;busy=true;
    try {
      const q=liveLayer.createQuery();q.where='1=1';q.outFields=['Latitude','Longitude','TextDateTime'];q.returnGeometry=false;
      const result=await liveLayer.queryFeatures(q);
      const current=result.features.map(parse).find(Boolean);
      if(!current)throw Error('Position feed returned no coordinates.');
      if(!live || current.t>live.t){
        live=current;
        const lag=(Date.now()-current.t)/60000;
        stamp.textContent='Fix '+new Date(current.t).toLocaleTimeString()+' · '+(lag>=0?Math.round(lag)+'m ago':'clock mismatch');
        state.textContent=lag>15?'Delayed feed':'Tracking';
        // Wait for the archive fix before first placement: the two feeds can disagree.
        if(mode==='live'&&!samples.length)state.textContent='Loading orbit…';
      }
      if(Date.now()-lastArchive>45000||samples.length===0){
        const query=archive.createQuery();query.where='1=1';
        query.outFields=['Datum'];query.returnGeometry=true;query.outSpatialReference=WGS;
        query.orderByFields=['Datum ASC'];query.num=2000;
        const history=await archive.queryFeatures(query);
        const hadSamples=samples.length>0;
        samples=history.features.map(parse).filter(p=>Number.isFinite(p.t)&&p.t>=Date.now()-86400000).sort((a,b)=>a.t-b.t);
        lastArchive=Date.now();
        if(mode==='live'&&!hadSamples&&samples.length){
          // Start at the same fix as the track instead of animating from another feed.
          smoothFix=livePosition()||samples.at(-1);shown=smoothFix;place(shown);
        }
        if(samples.length && (!live || samples.at(-1).t>live.t)) {
          live=samples.at(-1);
          const lag=(Date.now()-live.t)/60000;
          stamp.textContent='Fix '+new Date(live.t).toLocaleTimeString()+' · '+Math.max(0,Math.round(lag))+'m ago';
          state.textContent=lag>15?'Delayed feed':'Tracking';
          if(mode==='live'&&!shown){const p=livePosition()||live;place(p);shown=p;connectTail(p);}
        }
        updateReplayRange();show();
      }
    } catch(err){stamp.textContent='Feed unavailable · '+String(err.message||err);}
    finally{busy=false}
  };
  const change = e => {
    const enteringReplay=mode!=='replay';
    cursor=Number(e.target.value);mode='replay';updateLiveButton();setReplaySky();time.style.display='';playing=false;replayClock=0;
    play.textContent='';play.setAttribute('aria-label','Play replay');play.setAttribute('title','Play replay');play.setAttribute('icon-start','play');
    replayTime=Math.min(replayEnd(),replayStart()+cursor*60000);const p=atTime(replayTime);
    if(p){place(p);shown=p;}
    if(enteringReplay)moveCamera(p||shown||livePosition(),true,true);
    show();
  };
  const toggle = () => {
    playing=!playing;play.textContent='';play.setAttribute('aria-label',playing?'Pause replay':'Play replay');play.setAttribute('title',playing?'Pause replay':'Play replay');play.setAttribute('icon-start',playing?'pause':'play');
    if(playing){
      const enteringReplay=mode!=='replay';
      mode='replay';updateLiveButton();setReplaySky();time.style.display='';
      if(!samples.length){playing=false;play.textContent='';play.setAttribute('aria-label','Play replay');play.setAttribute('title','Play replay');state.textContent='No history available';return;}
      if(replayTime>=replayEnd()||!replayTime)replayTime=replayStart();
      replayClock=performance.now();syncCursor();show();
      if(enteringReplay)moveCamera(atTime(replayTime)||shown,true,true);
    }
  };
  const toLive=()=>{
    playing=false;mode='live';liveFollowing=true;updateLiveButton();setLiveSky();replayTime=0;replayClock=0;syncCursor();
    play.textContent='';play.setAttribute('aria-label','Play replay');play.setAttribute('title','Play replay');play.setAttribute('icon-start','play');
    const p=livePosition()||samples.at(-1)||live;if(p){smoothFix=p;place(p);shown=p;show();moveCamera(p,false,true);}
  };
  const setSpeed=e=>{const n=Number(e.target.value);if([1,2,4].includes(n))replaySpeed=n;};
  speedControl.addEventListener('calciteSegmentedControlChange',setSpeed);
  slider.addEventListener('calciteSliderInput',change);
  slider.addEventListener('calciteSliderChange',change);
  play.addEventListener('click',toggle);liveButton.addEventListener('click',toLive);
  const animate=now=>{
    if(disposed)return;
    frame=requestAnimationFrame(animate);
    if(now-lastDraw<90)return;
    const delta=Math.min(150,now-lastDraw||90);lastDraw=now;
    if(playing&&samples.length){
      replayTime=Math.min(replayEnd(),replayTime+delta*360*replaySpeed);
      const p=atTime(replayTime);if(p){place(p);shown=p;connectTail(p);}
      if(now-lastLabel>1200){setSkyTime(replayTime);syncCursor();
        time.textContent='Replay · '+new Date(replayTime).toLocaleString();drawTrail(replayTime);lastLabel=now;}
      if(replayTime>=replayEnd()){
        // Keep playing: restart at the oldest available observed fix. Redraw
        // before reconnecting the tip so no line bridges the loop boundary.
        replayTime=replayStart();
        const first=atTime(replayTime);if(first){place(first);shown=first;}
        tailLink.visible=false;lastTrailEnd=0;trail.removeAll();
        drawTrail(replayTime);syncCursor();
        time.textContent='Replay · '+new Date(replayTime).toLocaleString();
        replayClock=now;lastLabel=now;
      }
    }else if(mode==='live'){
      const target=livePosition();if(target){
        // Drive the station and tip from one displayed timestamp at no more
        // than 1.1x real time. New feed samples cannot jump either geometry.
        const previous=smoothFix||shown;
        const displayTime=previous?.t!=null?Math.min(target.t,previous.t+delta*1.1):target.t;
        const p=atTime(displayTime)||target;
        smoothFix=p;place(p);shown=p;connectTail(p);
        if(liveFollowing)moveCamera(p,false);
        if(now-lastLabel>950){syncLiveLighting(p);setSkyTime(Date.now());const age=(Date.now()-live.t)/60000;
          stamp.textContent='Fix '+new Date(live.t).toLocaleTimeString()+' · '+Math.max(0,Math.round(age))+'m ago';
          state.textContent=age>2?'Position stale':'Tracking';
          time.textContent='Live · '+new Date(p.t).toLocaleTimeString();lastLabel=now;}
      }
    }
  }; 
  setLiveSky();
  frame=requestAnimationFrame(animate);
  const poll=setInterval(()=>void refresh(),30000);
  app.actions.register('iss-status',()=>({mode,playing,replaySpeed,cursor,rangeMinutes:replayMinutes(),rangeStart:replayStart(),rangeEnd:replayEnd(),sliderMin:slider.min,sliderMax:slider.max,sliderValue:slider.value,sampleCount:samples.length,archiveHours:samples.length?(samples.at(-1).t-samples[0].t)/3600000:0,live:live?{lat:live.lat,lon:live.lon,ageMinutes:(Date.now()-live.t)/60000}:null,modelGraphics:model.graphics.length,trailGraphics:trail.graphics.length,groundGraphics:ground.graphics.length,cameraTilt:app.view.camera.tilt,cameraMode,liveScale,liveFollowing,liveButtonText:liveButton.textContent,displayed:shown?{lat:shown.lat,lon:shown.lon,t:shown.t,estimated:!!shown.estimated}:null,replayTime,trailRefreshes,lastTrailEnd,groundLabelUpdates,lastGroundText}));
  app.actions.register('iss-replay-test',()=>{const enteringReplay=mode!=='replay';mode='replay';updateLiveButton();setReplaySky();replayTime=Math.max(replayStart(),replayEnd()-30*60000);syncCursor();show();if(enteringReplay)moveCamera(atTime(replayTime)||shown,true,true);return {mode,cameraMode,caption:time.textContent,point:coords.textContent,trailGraphics:trail.graphics.length};});
  app.actions.register('iss-speed-test',({speed}={})=>{const n=Number(speed);if(![1,2,4].includes(n))return {error:'Choose 1, 2 or 4'};speedControl.value=String(n);replaySpeed=n;return {replaySpeed,controlValue:speedControl.value};});
  app.actions.register('iss-live-test',()=>{toLive();return {mode,caption:time.textContent,point:coords.textContent};});
  app.onCleanup(()=>{disposed=true;liveGlow?.cancel();cancelAnimationFrame(frame);clearInterval(poll);sceneInput.removeEventListener('pointerdown',stopFollowing,true);sceneInput.removeEventListener('wheel',stopFollowing,true);sceneInput.removeEventListener('keydown',stopFollowing,true);speedControl.removeEventListener('calciteSegmentedControlChange',setSpeed);slider.removeEventListener('calciteSliderInput',change);slider.removeEventListener('calciteSliderChange',change);play.removeEventListener('click',toggle);liveButton.removeEventListener('click',toLive);[model,tether,trail,nightShade,ground].forEach(l=>app.map.remove(l));sceneGround.layers=originalGroundLayers;sceneGround.opacity=originalGroundOpacity;app.view.padding=originalPadding;sceneContainer.style.filter=previousSceneFilter;sceneContainer.style.transition=previousFilterTransition;app.view.environment.atmosphereEnabled=originalSky.atmosphereEnabled;app.view.environment.starsEnabled=originalSky.starsEnabled;if(originalSky.lighting)app.view.environment.lighting=originalSky.lighting.clone();if(app.view.environment.lighting?.type==='sun')app.view.environment.lighting.glow=previousGlow;mount.replaceChildren();});
  void refresh();
}