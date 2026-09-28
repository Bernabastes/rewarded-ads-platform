import { Global, Module } from '@nestjs/common';
import { FfmpegTools, MEDIA_TOOLS } from './ffmpeg.tools';
import { MediaProcessor, MediaService } from './media.service';

@Global()
@Module({
  providers: [MediaService, MediaProcessor, { provide: MEDIA_TOOLS, useClass: FfmpegTools }],
  exports: [MediaService],
})
export class MediaModule {}