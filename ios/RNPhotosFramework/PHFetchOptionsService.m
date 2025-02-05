#import "PHFetchOptionsService.h"
#import <React/RCTConvert.h>
#import "RCTConvert+RNPhotosFramework.h"
@import Photos;
@implementation PHFetchOptionsService

+(PHFetchOptions *)getCommonFetchOptionsFromParams:(NSDictionary *)params andFetchOptions:(PHFetchOptions *)options {
    if ([options respondsToSelector:@selector(includeAssetSourceTypes)]) {
        // not available in iOS 8
        options.includeAssetSourceTypes = [RCTConvert PHAssetSourceTypes:params[@"sourceTypes"]];
    }
    options.includeHiddenAssets = [RCTConvert BOOL:params[@"includeHiddenAssets"]];
    options.includeAllBurstAssets = [RCTConvert BOOL:params[@"includeAllBurstAssets"]];
    options.fetchLimit = [RCTConvert int:params[@"fetchLimit"]];
    options.wantsIncrementalChangeDetails = YES;
    BOOL disableChangeTracking = [RCTConvert BOOL:params[@"disableChangeTracking"]];
    if(disableChangeTracking) {
        options.wantsIncrementalChangeDetails = NO;
    }
    options.predicate = [PHFetchOptionsService getPredicate:params];
    options.sortDescriptors = [self getSortDescriptorsFromParams:params];
    return options;
}

+(PHFetchOptions *)getAssetFetchOptionsFromParams:(NSDictionary *)outerParams {
    if(outerParams == nil) {
        return nil;
    }
    NSDictionary *params = [RCTConvert NSDictionary:outerParams[@"fetchOptions"]];
    PHFetchOptions *options = [[PHFetchOptions alloc] init];
    options = [self getCommonFetchOptionsFromParams:params andFetchOptions:options];
    return options;
}

+(PHFetchOptions *)getCollectionFetchOptionsFromParams:(NSDictionary *)outerParams {
    if(outerParams == nil) {
        return nil;
    }
    NSDictionary *params = [RCTConvert NSDictionary:outerParams[@"fetchOptions"]];
    PHFetchOptions *options = [[PHFetchOptions alloc] init];
    options = [self getCommonFetchOptionsFromParams:params andFetchOptions:options];
    //if(options.sortDescriptors == nil || options.sortDescriptors.count == 0) {
    //    options.sortDescriptors = @[[NSSortDescriptor sortDescriptorWithKey:@"title" ascending:YES]];
    //}
    return options;
}

+(NSArray<NSSortDescriptor *> *)getSortDescriptorsFromParams:(NSDictionary *)params {
    NSArray *sortDescriptors = [RCTConvert NSArray:params[@"sortDescriptors"]];
    if(sortDescriptors == nil || sortDescriptors.count == 0) {
        return nil;
    }
    NSMutableArray<NSSortDescriptor *> *nsSortDescriptors = [NSMutableArray arrayWithCapacity:sortDescriptors.count];
    for(int i = 0; i < sortDescriptors.count; i++) {
        NSDictionary *sortDescriptorObj = [RCTConvert NSDictionary:[sortDescriptors objectAtIndex:i]];
        BOOL sortAscending = [RCTConvert BOOL:sortDescriptorObj[@"ascending"]];
        NSString *sortDescriptorKey = [RCTConvert NSString:sortDescriptorObj[@"key"]];
        if(sortDescriptorKey != nil) {
            [nsSortDescriptors addObject:[NSSortDescriptor sortDescriptorWithKey:sortDescriptorKey ascending:sortAscending]];
        }
    }
    return nsSortDescriptors;
}

+(NSPredicate *) getCustomPredicatesForParams:(NSDictionary *)params {
    NSArray *customPredicates = [RCTConvert NSArray:params[@"customPredicates"]];
    if(customPredicates == nil || customPredicates.count == 0) {
        return nil;
    }
    NSMutableArray<NSPredicate *> *nsPredicates = [NSMutableArray arrayWithCapacity:customPredicates.count];
    for(int i = 0; i < customPredicates.count; i++) {
        NSDictionary *predicateObj = [RCTConvert NSDictionary:[customPredicates objectAtIndex:i]];
        NSString *predicate = [predicateObj objectForKey:@"predicate"];
        if(predicate != nil) {
            NSString *argument = [predicateObj objectForKey:@"predicateArg"];
            [nsPredicates addObject:[NSPredicate predicateWithFormat:predicate, argument]];
        }
    }
    return [NSCompoundPredicate andPredicateWithSubpredicates:nsPredicates];

}

+(PHFetchOptions *)extendWithDefaultsForAssets:(PHFetchOptions *)phFetchOptions {
    return nil;
}

+(NSPredicate *) getPredicate:(NSDictionary *)params  {
    NSPredicate *mediaTypePredicate = [PHFetchOptionsService getMediaTypePredicate:params];
    NSPredicate *subTypePredicate = [PHFetchOptionsService getMediaSubTypePredicate:params];
    NSPredicate *customPredicate = [PHFetchOptionsService getCustomPredicatesForParams:params];
    NSPredicate *creationDatePredicate = [PHFetchOptionsService getCreationDatePredicate:params];
    NSMutableArray *arrayWithPredicates = [NSMutableArray arrayWithCapacity:4];
    if(mediaTypePredicate) {
        [arrayWithPredicates addObject:mediaTypePredicate];
    }
    if(subTypePredicate) {
        [arrayWithPredicates addObject:subTypePredicate];
    }
    if(customPredicate) {
        [arrayWithPredicates addObject:customPredicate];
    }
    if(creationDatePredicate) {
        [arrayWithPredicates addObject:creationDatePredicate];
    }
    return [NSCompoundPredicate andPredicateWithSubpredicates:arrayWithPredicates];
}

+(NSPredicate *) getMediaTypePredicate:(NSDictionary *)params {
    NSArray<NSNumber *> * mediaTypes = [RCTConvert PHAssetMediaTypes:params[@"mediaTypes"]];
    if(mediaTypes == nil) {
        return nil;
    }
    return [NSPredicate predicateWithFormat:@"mediaType in %@", mediaTypes];
}

+(NSPredicate *) getMediaSubTypePredicate:(NSDictionary *)params {
    NSMutableArray * mediaSubTypes = [RCTConvert PHAssetMediaSubtypes:params[@"mediaSubTypes"]];
    if(mediaSubTypes == nil) {
        return nil;
    }
    NSMutableArray *arrayWithPredicates = [NSMutableArray arrayWithCapacity:mediaSubTypes.count];
    
    for(int i = 0; i < mediaSubTypes.count;i++) {
        PHAssetMediaSubtype mediaSubType = [[mediaSubTypes objectAtIndex:i] intValue];
        [arrayWithPredicates addObject:[NSPredicate predicateWithFormat:@"((mediaSubtype & %d) == %d)", mediaSubType, mediaSubType]];
    }
    
    return [NSCompoundPredicate orPredicateWithSubpredicates:arrayWithPredicates];
}

+(NSPredicate *) getCreationDatePredicate:(NSDictionary *)params {
    NSString * olderThan = [RCTConvert NSString:params[@"olderThan"]];
    if(olderThan == nil) {
        return nil;
    }
    NSNumberFormatter *f = [[NSNumberFormatter alloc] init];
    f.numberStyle = NSNumberFormatterDecimalStyle;
    NSNumber * timestamp = [f numberFromString:olderThan];
    if(timestamp == nil) {
        return nil;
    }
    NSDate * date = [NSDate dateWithTimeIntervalSince1970:timestamp.doubleValue / 1000];
    if(date == nil) {
        return nil;
    }
    return [NSPredicate predicateWithFormat:@"creationDate < %@", date];
}


@end
