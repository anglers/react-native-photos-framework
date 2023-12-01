import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import EventEmitter from "../event-emitter";
import AlbumQueryResultBase from './album-query-result-base';
import AlbumQueryResultCollection from "./album-query-result-collection";
import { collectionArrayObserverHandler } from './change-observer-handler';
import videoPropsResolver from "./video-props-resolver";
import uuidGenerator from "./uuid-generator";

const RNPFManager = NativeModules.RNPFManager;
if (!RNPFManager && Platform.OS === "ios") {
    throw new Error(
        "Could not find react-native-photos-framework's native module. It seems it's not linked correctly in your xcode-project."
    );
}
export const eventEmitter = new EventEmitter();

// Asset
export class Asset {
    static scheme = "photos://";
    constructor(assetObj) {
        Object.assign(this, assetObj);
        this._assetObj = assetObj;
    }

    get uri() {
        if (this.lastOptions === this.currentOptions && this._uri) {
            return this._uri;
        }
        let queryString;
        if (this.currentOptions) {
            this.lastOptions = this.currentOptions;
            queryString = this.serialize(this.currentOptions);
        }
        this._uri = Asset.scheme + this.localIdentifier;
        if (queryString) {
            this._uri = this._uri + `?${queryString}`;
        }
        return this._uri;
    }

    //This is here in base-class, videos can display thumb.
    get image() {
        if (this._imageRef) {
            return this._imageRef;
        }
        const {
            width,
            height,
            uri
        } = this;
        this._imageRef = {
            width,
            height,
            uri,
            name: 'test.jpg'
        };
        return this._imageRef;
    }

    get creationDate() {
        return this.toJsDate('creationDateUTCSeconds', '_creationDate');
    }

    get modificationDate() {
        return this.toJsDate('modificationDateUTCSeconds', '_modificationDate');
    }

    toJsDate(UTCProperty, cachedProperty) {
        if (!this[UTCProperty]) {
            return undefined;
        }
        if (!this[cachedProperty]) {
            const utcSecondsCreated = this[UTCProperty];
            this[cachedProperty] = new Date(0);
            this[cachedProperty].setUTCSeconds(utcSecondsCreated);
        }
        return this[cachedProperty];
    }

    getMetadata() {
        return this._fetchExtraData('getAssetsMetadata', 'creationDate');
    }

    refreshMetadata() {
        return this._fetchExtraData('getAssetsMetadata', 'creationDate', true);
    }

    getResourcesMetadata() {
        return this._fetchExtraData('getAssetsResourcesMetadata', 'resourcesMetadata');
    }

    getExifData() {
        return this._fetchExtraData('getExifData', 'exif');
    }

    _fetchExtraData(nativeMethod, alreadyLoadedProperty, force) {
        return new Promise((resolve, reject) => {
            if (!force && this[alreadyLoadedProperty]) {
                //This means we alread have fetched metadata.
                //Resolve directly
                resolve(this);
                return;
            }
            if(!NativeApi[nativeMethod])
            {
                console.log("Method '" + nativeMethod  + "' not found", NativeApi);
                reject();
            }
            return resolve(NativeApi[nativeMethod]([this.localIdentifier])
                .then((metadataObjs) => {
                    if (metadataObjs && metadataObjs[this.localIdentifier]) {
                        Object.assign(this, metadataObjs[this.localIdentifier]);
                    }
                    return this;
                }));
        });
    }

    serialize(obj) {
        var str = [];
        for (var p in obj) {
            if (obj.hasOwnProperty(p)) {
                str.push(encodeURIComponent(p) + "=" + encodeURIComponent(
                    obj[p]));
            }
        }
        return str.join("&");
    }

    withOptions(options) {
        this.currentOptions = options;
        return this;
    }

    delete() {
        return NativeApi.deleteAssets([this]);
    }

    setHidden(hidden) {
        return this._updateProperty('hidden', hidden, true);
    }

    setFavorite(favorite) {
        return this._updateProperty('favorite', favorite, true);
    }

    setCreationDate(jsDate) {
        return this._updateProperty('creationDate', jsDate, false);
    }

    setLocation(latLngObj) {
        return this._updateProperty('location', latLngObj, false);
    }

    //name and extension are optional
    saveAssetToDisk(options, onProgress, generateFileName) {
        return NativeApi.saveAssetsToDisk([{
            asset: this,
            options: options
        }], {
                onProgress: onProgress
            }, generateFileName).then((results) => {
                return results[0];
            });
    }

    _updateProperty(property, value, precheckValue) {
        return new Promise((resolve, reject) => {
            if (precheckValue && this[property] === value) {
                return resolve({
                    success: true,
                    error: ''
                });
            }
            return NativeApi.updateAssets({
                [this.localIdentifier]: {
                    [property]: value
                }
            }).then(resolve, reject);
        });
    }
}

// ImageAsset
export class ImageAsset extends Asset {
    constructor(assetObj, options) {
        super(assetObj, options);
    }

    getImageMetadata() {
        return this._fetchExtraData('getImageAssetsMetadata', 'imageMetadata');
    }
} 

// videoAsset
export class VideoAsset extends Asset {
    constructor(assetObj, options) {
        super(assetObj, options);
    }

    get video() {
        if (this._videoRef) {
            return this._videoRef;
        }
        this._videoRef = {
            uri : this.uri,
            type : ''
        };
        return this._videoRef;
    }
}

// Album
export class Album extends EventEmitter {

    constructor(obj, fetchOptions, eventEmitter) {
        super();
        this._fetchOptions = fetchOptions;
        Object.assign(this, obj);
        if (this.previewAssets) {
            this.previewAssets = this
                .previewAssets
                .map(NativeApi.createJsAsset);
            if (this.previewAssets.length) {
                this.previewAsset = this.previewAssets[0];
            }
        }

        eventEmitter.addListener('onObjectChange', (changeDetails) => {
            if (changeDetails._cacheKey === this._cacheKey) {
                this._emitChange(changeDetails, (assetArray, callback, fetchOptions) => {
                    if (assetArray) {
                        return assetArrayObserverHandler(
                            changeDetails, assetArray,
                            NativeApi.createJsAsset, (indecies, callback) => {
                                //The update algo has requested new assets.
                                return this.newAssetsRequested(indecies, fetchOptions, callback);
                            }, this.perferedSortOrder).then(updatedArray => {
                            callback && callback(updatedArray);
                            return updatedArray;
                        });
                    }
                    return assetArray;
                }, this);
            }
        });
    }

    newAssetsRequested(indecies, fetchOptions, callback) {
        const fetchOptionsWithIndecies = {...fetchOptions, indecies : [...indecies]};
        return this.getAssetsWithIndecies(fetchOptionsWithIndecies).then((assets) => {
            callback && callback(assets);
            return assets;
        });
    }

    deleteContentPermitted() {
        return this._canPerformOperation(0);
    }

    removeContentPermitted() {
        return this._canPerformOperation(1);
    }

    addContentPermitted() {
        return this._canPerformOperation(2);
    }

    createContentPermitted() {
        return this._canPerformOperation(3);
    }

    reArrangeContentPermitted() {
        return this._canPerformOperation(4);
    }

    deletePermitted() {
        return this._canPerformOperation(5);
    }

    renamePermitted() {
        return this._canPerformOperation(6);
    }

    _canPerformOperation(index) {
        return this.permittedOperations && this.permittedOperations[index];
    }

    stopTracking() {
        return NativeApi.stopTracking(this._cacheKey);
    }

    getAssets(params) {
        this.perferedSortOrder = params.assetDisplayBottomUp === params.assetDisplayStartToEnd ? 'reversed' : 'normal';
        const trackAssets = params.trackInsertsAndDeletes || params.trackAssetsChanges;
        if (trackAssets && !this._cacheKey) {
            this._cacheKey = uuidGenerator();
        }
        return NativeApi.getAssets({
            fetchOptions: this._fetchOptions,
            ...params,
            _cacheKey: this._cacheKey,
            albumLocalIdentifier: this.localIdentifier
        });
    }

    getAssetsWithIndecies(params) {
        const trackAssets = params.trackInsertsAndDeletes || params.trackAssetsChanges;
        if (trackAssets && !this._cacheKey) {
            this._cacheKey = uuidGenerator();
        }
        return NativeApi.getAssetsWithIndecies({
            fetchOptions: this._fetchOptions,
            ...params,
            _cacheKey: this._cacheKey,
            albumLocalIdentifier: this.localIdentifier
        });
    }

    addAsset(asset) {
        return this.addAssets([asset]);
    }

    addAssets(assets) {
        return NativeApi.addAssetsToAlbum({
            assets: assets.map(asset => asset.localIdentifier),
            _cacheKey: this._cacheKey,
            albumLocalIdentifier: this.localIdentifier
        });
    }

    removeAsset(asset) {
        return this.removeAssets([asset]);
    }

    removeAssets(assets) {
        return NativeApi.removeAssetsFromAlbum({
            assets: assets.map(asset => asset.localIdentifier),
            _cacheKey: this._cacheKey,
            albumLocalIdentifier: this.localIdentifier
        });
    }

    updateTitle(newTitle) {
        return NativeApi.updateAlbumTitle({
            newTitle: newTitle,
            _cacheKey: this._cacheKey,
            albumLocalIdentifier: this.localIdentifier
        });
    }

    delete() {
        return NativeApi.deleteAlbums([this]);
    }

    onChange(cb) {
        this.addListener('onChange', cb);
        return () => this.removeListener('onChange', cb);
    }

    _emitChange(...args) {
        this.emit('onChange', ...args);
    }
}

// AlbumQueryResult
export class AlbumQueryResult extends AlbumQueryResultBase {
    constructor(obj, fetchParams, eventEmitter) {
        super();
        this.eventEmitter = eventEmitter;
        this._fetchParams = fetchParams || {};
        Object.assign(this, obj);
        this._albumNativeObjs = this.albums;
        this.albums = this
            ._albumNativeObjs
            .map(albumObj => new Album(albumObj, this._fetchParams.assetFetchOptions,
                eventEmitter));
        eventEmitter.addListener('onObjectChange', (changeDetails) => {
            if (this._cacheKey === changeDetails._cacheKey) {
                this.emit('onChange', changeDetails, (callback) => {
                    this.applyChangeDetails(changeDetails, callback);
                }, this);
            }
        });
    }

    stopTracking() {
        return NativeApi.stopTracking(this._cacheKey);
    }

    applyChangeDetails(changeDetails, callback) {
        return collectionArrayObserverHandler(changeDetails, this.albums, (
            nativeObj) => {
            return new Album(nativeObj, this._fetchParams.fetchOptions,
                this.eventEmitter);
        }).then((albums) => {
            this.albums = albums;
            callback && callback(this);
        });
    }
}


// Main JS-implementation Most methods are written to handle array of input
// operations.
class RNPhotosFramework {
    constructor() {
        this.nativeEventEmitter = new NativeEventEmitter(
            NativeModules.RNPFManager
        );
        this.nativeEventEmitter.addListener("onObjectChange", changeDetails => {
            eventEmitter.emit("onObjectChange", changeDetails);
        });
        this.nativeEventEmitter.addListener(
            "onLibraryChange",
            changeDetails => {
                eventEmitter.emit("onLibraryChange", changeDetails);
            }
        );

        //We need to make sure we clean cache in native before any calls
        //go into RNPF. This is important when running in DEV because we reastart
        //often in RN. (Live reload).
        const methodsWithoutCacheCleanBlock = [
            "constructor",
            "libraryStartup",
            "authorizationStatus",
            "requestAuthorization",
            "createJsAsset",
            "withUniqueEventListener",
        ];
        const methodNames = Object.getOwnPropertyNames(
            RNPhotosFramework.prototype
        ).filter(
            method => methodsWithoutCacheCleanBlock.indexOf(method) === -1
        );
        methodNames.forEach(methodName => {
            const originalMethod = this[methodName];
            this[methodName] = function(...args) {
                if (!this.libraryStartupPromise) {
                    this.libraryStartupPromise = this.libraryStartup();
                }
                return this.libraryStartupPromise.then(() =>
                    originalMethod.apply(this, args)
                );
            }.bind(this);
        });
    }

    onLibraryChange(cb) {
        return eventEmitter.addListener("onLibraryChange", cb);
    }

    libraryStartup() {
        return RNPFManager.libraryStartup(true);
    }

    authorizationStatus() {
        return RNPFManager.authorizationStatus();
    }

    requestAuthorization() {
        return RNPFManager.requestAuthorization();
    }

    setAllowsCachingHighQualityImages(allowed) {
        return RNPFManager.setAllowsCachingHighQualityImages(allowed);
    }

    addAssetsToAlbum(params) {
        return RNPFManager.addAssetsToAlbum(params);
    }

    removeAssetsFromAlbum(params) {
        return RNPFManager.removeAssetsFromAlbum(params);
    }

    stopCachingImagesForAllAssets() {
        return RNPFManager.stopCachingImagesForAllAssets();
    }

    getAssets(params) {
        //This might look hacky, but it is!
        //We default to assetDisplayStartToEnd == false because photos framework will by default
        //give us the results in the same order as the photos-app displays them. The most recent image last that is.
        //BUT in this library we have decided to reverse that default, because most third-party apps wants (our guesses)
        //the most recent photo first. So by default we load the results in reverse by saying assetDisplayStartToEnd = false.
        //However. If this option is not expicitly set and you provide a saortDescriptor, we no longer want to reverse the ordser
        //of the photos. Then we want to display them as is. So here we check for that scenario. If the key assetDisplayStartToEnd is
        //not explicitly set and there is a sortDescriptor, do not reverse the order of the photos by assetDisplayStartToEnd = true.
        if (
            params &&
            params.fetchOptions &&
            params.assetDisplayStartToEnd === undefined &&
            params.fetchOptions.sortDescriptors &&
            params.fetchOptions.sortDescriptors.length
        ) {
            params.assetDisplayStartToEnd = true;
        }
        return RNPFManager.getAssets(params).then(assetsResponse => {
            return {
                assets: assetsResponse.assets.map(this.createJsAsset),
                includesLastAsset: assetsResponse.includesLastAsset,
            };
        });
    }

    getAssetsWithIndecies(params) {
        return RNPFManager.getAssetsWithIndecies(
            params
        ).then(assetsResponse => {
            return assetsResponse.assets.map(this.createJsAsset);
        });
    }

    getAlbumsCommon(params, asSingleQueryResult) {
        return this.getAlbumsMany(
            [
                Object.assign(
                    {
                        type: "smartAlbum",
                        subType: "any",
                    },
                    params
                ),
                Object.assign(
                    {
                        type: "album",
                        subType: "any",
                    },
                    params
                ),
            ],
            asSingleQueryResult
        ).then(albumQueryResult => {
            return albumQueryResult;
        });
    }

    getAlbums(params) {
        return this.getAlbumsMany([params]).then(queryResults => {
            return queryResults[0];
        });
    }

    getAlbumsMany(params, asSingleQueryResult) {
        return this._getAlbumsManyRaw(params).then(albumQueryResultList => {
            const albumQueryResults = albumQueryResultList.map(
                (collection, index) =>
                    new AlbumQueryResult(
                        collection,
                        params[index],
                        eventEmitter
                    )
            );
            if (asSingleQueryResult) {
                return new AlbumQueryResultCollection(
                    albumQueryResults,
                    params,
                    eventEmitter
                );
            }
            return albumQueryResults;
        });
    }

    _getAlbumsManyRaw(params) {
        return RNPFManager.getAlbumsMany(params);
    }

    getAlbumsByTitle(title) {
        return this.getAlbumsWithParams({
            albumTitles: [title],
        });
    }

    getAlbumsByTitles(titles) {
        return this.getAlbumsWithParams({
            albumTitles: titles,
        });
    }

    // param should include property called albumTitles : array<string> But can also
    // include things like fetchOptions and type/subtype.
    getAlbumsWithParams(params) {
        return RNPFManager.getAlbumsByTitles(params).then(albumQueryResult => {
            return new AlbumQueryResult(albumQueryResult, params, eventEmitter);
        });
    }

    createAlbum(albumTitle) {
        return this.createAlbums([albumTitle]).then(albums => {
            return albums[0];
        });
    }

    createAlbums(albumTitles) {
        return RNPFManager.createAlbums(albumTitles).then(albums => {
            return albums.map(
                album => new Album(album, undefined, eventEmitter)
            );
        });
    }

    updateAlbumTitle(params) {
        //minimum params: {newTitle : 'x', albumLocalIdentifier : 'guid'}
        return RNPFManager.updateAlbumTitle(params);
    }

    updateAssets(assetUpdateObjs) {
        /* assetUpdateObj : {localIdentifier : {creationDate, location, favorite, hidden}} */
        const arrayWithLocalIdentifiers = Object.keys(assetUpdateObjs);
        return RNPFManager.updateAssets(
            arrayWithLocalIdentifiers,
            assetUpdateObjs
        ).then(result => {
            return result;
        });
    }

    getAssetsMetadata(assetsLocalIdentifiers) {
        return RNPFManager.getAssetsMetadata(assetsLocalIdentifiers);
    }

    getAssetsResourcesMetadata(assetsLocalIdentifiers) {
        return RNPFManager.getAssetsResourcesMetadata(assetsLocalIdentifiers);
    }

    getExifData(assetsLocalIdentifiers) {
        return RNPFManager.getImageAssetsExif(assetsLocalIdentifiers);
    }

    updateAssetsWithResoucesMetadata(assets) {
        return new Promise((resolve, reject) => {
            const assetsWithoutRoesourceMetaData = assets.filter(
                asset => asset.resourcesMetadata === undefined
            );
            if (assetsWithoutRoesourceMetaData.length) {
                RNPFManager.getAssetsResourcesMetadata(
                    assetsWithoutRoesourceMetaData.map(
                        asset => asset.localIdentifier
                    )
                ).then(result => {
                    assetsWithoutRoesourceMetaData.forEach(asset => {
                        Object.assign(asset, result[asset.localIdentifier]);
                    });
                    resolve(assets);
                });
            } else {
                resolve(assets);
            }
        });
    }

    getImageAssetsMetadata(assetsLocalIdentifiers) {
        return RNPFManager.getImageAssetsMetadata(assetsLocalIdentifiers);
    }

    deleteAssets(assets) {
        return RNPFManager.deleteAssets(
            assets.map(asset => asset.localIdentifier)
        );
    }

    deleteAlbums(albums) {
        return RNPFManager.deleteAlbums(
            albums.map(album => album.localIdentifier)
        );
    }

    createImageAsset(image) {
        return this.createAssets({
            images: [image],
        }).then(result => result[0]);
    }

    createVideoAsset(video) {
        return this.createAssets({
            videos: [video],
        }).then(result => result[1]);
    }

    getPostableAssets(localIdentifiers) {
        return RNPFManager.getPostableAssets(localIdentifiers);
    }

    createAssets(params, onProgress) {
        const images = params.images;
        const videos =
            params.videos !== undefined
                ? params.videos.map(videoPropsResolver)
                : params.videos;
        let media = [];
        if (images && images.length) {
            media = media.concat(
                images.map(image => ({
                    type: "image",
                    source: image,
                }))
            );
        }
        if (videos && videos.length) {
            media = media.concat(
                videos.map(video => ({
                    type: "video",
                    source: video,
                }))
            );
        }

        const { args, unsubscribe } = this.withUniqueEventListener(
            "onCreateAssetsProgress",
            {
                media: media,
                albumLocalIdentifier: params.album
                    ? params.album.localIdentifier
                    : undefined,
                includeMetadata: params.includeMetadata,
            },
            onProgress
        );
        return RNPFManager.createAssets(args).then(result => {
            unsubscribe && this.nativeEventEmitter.removeListener(unsubscribe);
            return result.assets.map(this.createJsAsset);
        });
    }

    withUniqueEventListener(eventName, params, cb) {
        let subscription;
        if (cb) {
            params[eventName] = uuidGenerator();
            subscription = this.nativeEventEmitter.addListener(
                eventName,
                data => {
                    if (cb && data.id && data.id === params[eventName]) {
                        cb(data);
                    }
                }
            );
        }
        return {
            args: params,
            unsubscribe: subscription,
        };
    }

    stopTracking(cacheKey) {
        return new Promise((resolve, reject) => {
            if (cacheKey) {
                return resolve(RNPFManager.stopTracking(cacheKey));
            } else {
                resolve({
                    success: true,
                    status: "was-not-tracked",
                });
            }
        });
    }

    asSingleQueryResult(albumQueryResultList, params, eventEmitter) {
        return new AlbumQueryResultCollection(
            albumQueryResultList,
            params,
            eventEmitter
        );
    }

    createJsAsset(nativeObj, options) {
        switch (nativeObj.mediaType) {
            case "image":
                return new ImageAsset(nativeObj, options);
            case "video":
                return new VideoAsset(nativeObj, options);
        }
    }

    /*
      assets,
      options : {
        dir : '/path', //optional
      },
      generateFileName : (asset, resourceMetadata) => {
        return 'newFileName';
      }
  */

    saveAssetsToDisk(assetsWithOptions, options, generateFileName) {
        const { args, unsubscribe } = this.withUniqueEventListener(
            "onSaveAssetsToFileProgress",
            {},
            options.onProgress
        );

        return this.updateAssetsWithResoucesMetadata(
            assetsWithOptions.map(assetWithOption => assetWithOption.asset)
        ).then(() => {
            return RNPFManager.saveAssetsToDisk({
                media: assetsWithOptions.map(assetWithOption => {
                    const { asset } = assetWithOption;

                    // resourceMetadata zou er moeten zijn, maar mist, geen idee waarom, dit komt rechtstreeks vanuit native
                    // logging toegevoegd zodat we mogelijk met Sentry kunnen achterhalen wat voor soort files dit zijn
                    if(!assetWithOption.asset.resourcesMetadata)
                        console.log(JSON.stringify(assetWithOption.asset));

                    const resourceMetadata =
                        assetWithOption.asset.resourcesMetadata[0];
                    const fileName =
                        generateFileName !== undefined
                            ? generateFileName(
                                  assetWithOption.asset,
                                  resourceMetadata
                              )
                            : resourceMetadata.originalFilename;
                    return {
                        fileName,
                        ...resourceMetadata,
                        uri: asset.uri,
                        localIdentifier: asset.localIdentifier,
                        mediaType: asset.mediaType,
                        ...assetWithOption.options,
                        exif: asset.imageExif,
                    };
                }),
                events: {
                    onSaveAssetsToFileProgress: args.onSaveAssetsToFileProgress,
                },
            });
        });
    }
}

export default new RNPhotosFramework();
