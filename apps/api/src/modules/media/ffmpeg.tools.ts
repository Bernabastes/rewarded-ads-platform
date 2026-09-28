import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppConfig } from '../../config/app-config';

export interface ProbeResult {
  durationSeconds: number;
  codec: string | null;
  width: number | null;
  height: number | null;
  bitrate: number | null;
  container: string | null;
}

/** Thin abstraction over the ffmpeg/ffprobe binaries so the pipeline can be unit-tested with a fake. */
export interface MediaTools {
  probe(inputPath: string, timeoutMs: number): Promise<ProbeResult>;
  transcode(inputPath: string, outputPath: string, targetHeight: number, timeoutMs: number): Promise<void>;
  poster(inputPath: string, outputPath: string, timeoutMs: number): Promise<void>;
  describe(): { ffmpeg: string; ffprobe: string };
}

export const MEDIA_TOOLS = Symbol('MEDIA_TOOLS');

/**
 * Resolves binaries in this order: explicit env path (the Docker image installs `apk ffmpeg`), the desktop binaries
 * installed by `pnpm media:tools` into <repo>/tools/media, a dependency named `ffmpeg-static` / `ffprobe-static`
 * (if a developer added one), then plain `ffmpeg`/`ffprobe` on PATH.
 */
export function resolveBinary(kind: 'ffmpeg' | 'ffprobe', explicit?: string): string {
  if (explicit) return explicit;
  const pkg = kind === 'ffmpeg' ? 'ffmpeg-static' : 'ffprobe-static';
  const candidates = [
    resolve(process.cwd(), 'tools', 'media', 'node_modules', pkg),
    resolve(process.cwd(), '..', '..', 'tools', 'media', 'node_modules', pkg),
    resolve(__dirname, '..', '..', '..', '..', '..', 'tools', 'media', 'node_modules', pkg),
    pkg,
  ];
  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(candidate) as string | { path?: string } | null;
      const bin = typeof mod === 'string' ? mod : mod?.path;
      if (bin && existsSync(bin)) return bin;
    } catch {
      /* not installed here - try the next location */
    }
  }
  return kind;
}

@Injectable()
export class FfmpegTools implements MediaTools {
  private readonly logger = new Logger(FfmpegTools.name);
  private readonly ffmpeg: string;
  private readonly ffprobe: string;

  constructor(config: AppConfig) {
    this.ffmpeg = resolveBinary('ffmpeg', config.media.ffmpegPath);
    this.ffprobe = resolveBinary('ffprobe', config.media.ffprobePath);
    this.logger.log(`Media tools: ffmpeg=${this.ffmpeg} ffprobe=${this.ffprobe}`);
  }

  describe() {
    return { ffmpeg: this.ffmpeg, ffprobe: this.ffprobe };
  }

  async probe(inputPath: string, timeoutMs: number): Promise<ProbeResult> {
    const stdout = await run(
      this.ffprobe,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration,format_name,bit_rate:stream=codec_type,codec_name,width,height',
        '-of',
        'json',
        inputPath,
      ],
      timeoutMs,
    );
    return parseProbe(stdout);
  }

  async transcode(inputPath: string, outputPath: string, targetHeight: number, timeoutMs: number) {
    // Inputs without an audio stream are fine: ffmpeg simply emits no audio track.
    await run(
      this.ffmpeg,
      [
        '-y',
        '-i',
        inputPath,
        '-vf',
        `scale=-2:'min(${targetHeight},ih)'`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        outputPath,
      ],
      timeoutMs,
    );
  }

  async poster(inputPath: string, outputPath: string, timeoutMs: number) {
    await run(
      this.ffmpeg,
      ['-y', '-ss', '1', '-i', inputPath, '-frames:v', '1', '-vf', "scale=-2:'min(720,ih)'", outputPath],
      timeoutMs,
    );
  }
}

/** Parses `ffprobe -of json` output into a compact ProbeResult. */
export function parseProbe(stdout: string): ProbeResult {
  const json = JSON.parse(stdout) as {
    format?: { duration?: string; format_name?: string; bit_rate?: string };
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
  };
  const video = json.streams?.find((s) => s.codec_type === 'video');
  const duration = Number(json.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('ffprobe returned no duration');
  return {
    durationSeconds: duration,
    codec: video?.codec_name ?? null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    bitrate: json.format?.bit_rate ? Number(json.format.bit_rate) : null,
    container: json.format?.format_name ?? null,
  };
}

function run(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const killed = (err as { killed?: boolean }).killed;
          reject(
            new Error(
              killed
                ? `${bin} timed out after ${timeoutMs} ms`
                : `${bin} failed: ${(stderr || err.message).toString().slice(-500)}`,
            ),
          );
          return;
        }
        resolve(stdout.toString());
      },
    );
  });
}
