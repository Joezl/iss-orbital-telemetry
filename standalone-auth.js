const config = {"mode":"public","portalUrl":"https://esridevbeijing.maps.arcgis.com"};
const moduleIds = {"identityManager":"@arcgis/core/identity/IdentityManager.js","oauthInfo":"@arcgis/core/identity/OAuthInfo.js","config":"@arcgis/core/config.js"};
const catalog = {"en-US":{"reading":"Reading…","readAt":"Read {time}","staleError":"Stale — {message}","unavailableError":"Unavailable — {message}","targetValue":"Target {value}","changeFrom":"Change from {label}","noFeaturesMatch":"No features match.","total":"Total","all":"All","appLoadError":"This app could not load: {message}","moduleLoaderUnavailable":"The ArcGIS module loader is unavailable.","actionsForLayer":"Actions for {title}","adjustBuffer":"Adjust buffer","arcgisBufferUnavailable":"ArcGIS buffer operations are unavailable in this app.","ask":"Ask","askNova":"Ask Nova about this","attachToChat":"Attach to chat","back":"Back","backToMapContents":"Back to map contents","backToSelectionActions":"Back to selection actions","basemap":"Basemap","basemapApplyError":"Basemap could not be applied.","basemapsLoadError":"Basemaps could not be loaded","buffer":"Buffer","bufferCreateError":"Buffer could not be created.","bufferDistance":"{distance} meter buffer","bufferMinimum":"Enter a distance of at least 25 meters.","bufferProjectionNotice":"The buffer follows the map projection and may not appear circular.","bufferSelection":"Create a buffer","cancel":"Cancel","cancelBuffer":"Cancel buffer","clearAllLayers":"Remove all layers","clearAllLayersHeading":"Remove all layers?","closeSelectedFeatures":"Close selected features","closeSpatialSuggestions":"Close spatial suggestions","collapseLayer":"Collapse layer","collapsePanel":"Collapse {title}","collapseUntitledPanel":"Collapse panel","copyLayerUrl":"Copy layer URL","darkGrayCanvas":"Dark Gray Canvas","details":"Details","distanceMeters":"Distance (meters)","editInChat":"Edit in chat","enableTerrain":"Enable terrain","disableTerrain":"Disable terrain","expandLayer":"Expand layer","expandPanel":"Expand {title}","expandUntitledPanel":"Expand panel","hideLayer":"Hide {title}","hideMapContents":"Hide map contents","imagery":"Imagery","keepBuffer":"Keep buffer","layers":"Layers","loadingLegend":"Loading legend","mapContents":"Map contents","mark":"Mark","markLocation":"Mark this location","markSaveUnconfirmed":"Mark save was not confirmed.","markedLocation":"Marked location {count}","moveDown":"Move down","moveUp":"Move up","nationalGeographic":"National Geographic","navigation":"Navigation","next":"Next","noBasemaps":"No basemaps found","noLayers":"No layers","noMatchingLayers":"No matching layers","openBasemapPanel":"Open basemap panel","other":"Other","pauseSteps":"Pause","playSteps":"Play through each step","previous":"Previous","rangeMaximum":"{label}, maximum","rangeMinimum":"{label}, minimum","removeAllLayersConfirmation":"Remove all operational layers and graphics?","removeLayer":"Remove layer","resizeBuffer":"Drag to resize buffer","searchBasemaps":"Search basemaps","searchLayers":"Search layers","savingMark":"Saving mark...","selectedFeature":"Selected feature","selectedFeatures":"Selected features","selectionActions":"Selection actions","selectionBuffer":"Selection buffer","selectionBufferTitle":"{distance} m selection buffer","stopTour":"Stop tour","tourPlaces":"Tour these places","noSavedPlaces":"This map has no saved bookmarks or slides.","noPlaces":"No features with a location match this source.","selectionGeometryError":"The selected geometry could not be converted into a buffer polygon.","showFeaturePosition":"{current} of {total}","showLayer":"Show {title}","suggest":"Suggest","suggestRelevantActions":"Suggest relevant actions","suggestionsUnavailable":"Suggestions could not be loaded. Try again.","thinking":"Thinking","topographic":"Topographic","terrain":"Terrain","untitledLayer":"Untitled layer","viewDetails":"View details","zoomToLayer":"Zoom to layer","zoomIn":"Zoom in","zoomOut":"Zoom out","resetCompass":"Reset compass","resizeMapContents":"Resize map contents"}};
const locale = document.documentElement.lang || 'en-US';
const messages = catalog[locale] ?? catalog[locale.split('-', 1)[0]] ?? catalog['en-US'];

function showFailure(error) {
  const node = document.getElementById('app-error');
  if (!node) return;
  node.hidden = false;
  node.textContent = error instanceof Error ? error.message : String(error);
}

async function start() {
  const loader = globalThis.$arcgis;
  if (!loader || typeof loader.import !== 'function') {
    throw new Error(messages.moduleLoaderUnavailable);
  }
  const esriConfig = await loader.import(moduleIds.config);
  const portalUrl = config.portalUrl;
  // Item ids, helper services and the basemap gallery resolve against this portal in both modes.
  if (portalUrl) esriConfig.portalUrl = portalUrl;
  if (config.mode === 'public') {
    await import('./app.js');
    return;
  }
  const [IdentityManager, OAuthInfo] = await Promise.all([
    loader.import(moduleIds.identityManager),
    loader.import(moduleIds.oauthInfo),
  ]);
  IdentityManager.registerOAuthInfos([
    new OAuthInfo({
      appId: config.appId,
      portalUrl,
      redirectUri: config.redirectUri,
      popup: false,
    }),
  ]);
  const sharingUrl = portalUrl.replace(/\/+$/, '') + '/sharing';
  try {
    await IdentityManager.checkSignInStatus(sharingUrl);
  } catch {
    await IdentityManager.getCredential(sharingUrl);
    location.reload();
    return;
  }
  await import('./app.js');
}

void start().catch(showFailure);
