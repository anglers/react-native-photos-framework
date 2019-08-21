#if __has_include(<React/RCTImageLoader.h>)
#import <React/RCTImageLoader.h>
#else
#import <React-RCTImage/React/RCTImageLoader.h>
#endif
#import "PHCachingImageManagerInstance.h"

typedef void (^RNPFDataLoaderCompletionBlock)(NSError *error, NSData *data);

@interface RNPFImageLoader : NSObject <RCTImageURLLoader>

-(RCTImageLoaderCancellationBlock) loadAssetAsData:(NSURL *)imageURL                                  completionHandler:(RNPFDataLoaderCompletionBlock)completionHandler;

@end
