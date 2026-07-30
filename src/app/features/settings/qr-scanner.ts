import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

type ScanStatus = 'starting' | 'scanning' | 'error';

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

/**
 * In-app QR scanner. Streams the rear camera into a `<video>` and decodes
 * frames with the native `BarcodeDetector` when available, falling back to a
 * dynamically-imported `jsQR` (Firefox / desktop Safari). Emits the decoded
 * text once and stops; releases the camera on destroy.
 */
@Component({
  selector: 'app-qr-scanner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule],
  template: `
    <div class="flex flex-col gap-3" data-testid="qr-scanner">
      <div class="relative overflow-hidden rounded-xl bg-black/80 aspect-square max-w-xs mx-auto">
        <video #video class="h-full w-full object-cover" playsinline muted></video>
        @if (status() !== 'scanning') {
          <div
            class="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white/80"
          >
            {{ status() === 'error' ? errorMessage() : 'Starting camera…' }}
          </div>
        }
      </div>
      <p class="text-center text-xs text-[var(--mat-sys-on-surface-variant)]">
        Point the camera at the QR code on your other device.
      </p>
      <button mat-stroked-button type="button" (click)="stop()" data-testid="qr-scanner-cancel">
        <mat-icon>close</mat-icon>
        Cancel
      </button>
    </div>
  `,
})
export class QrScanner {
  private readonly videoRef = viewChild.required<ElementRef<HTMLVideoElement>>('video');

  readonly scanned = output<string>();
  readonly cancelled = output<void>();

  protected readonly status = signal<ScanStatus>('starting');
  protected readonly errorMessage = signal('');

  private stream: MediaStream | null = null;
  private rafId = 0;
  private detector: BarcodeDetectorLike | null = null;
  private jsQR: typeof import('jsqr').default | null = null;
  private stopped = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.teardown());
    afterNextRender(() => void this.start());
  }

  private async start(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      if (this.stopped) return this.teardown();

      const video = this.videoRef().nativeElement;
      video.srcObject = this.stream;
      await video.play();

      const Ctor = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
        .BarcodeDetector;
      if (Ctor) {
        this.detector = new Ctor({ formats: ['qr_code'] });
      } else {
        this.jsQR = (await import('jsqr')).default;
      }

      this.status.set('scanning');
      this.tick();
    } catch (err) {
      console.error('[QrScanner]', err);
      this.errorMessage.set('Camera unavailable. Grant camera access, or use copy/paste instead.');
      this.status.set('error');
    }
  }

  private tick = (): void => {
    if (this.stopped) return;
    const video = this.videoRef().nativeElement;
    if (video.readyState < video.HAVE_ENOUGH_DATA) {
      this.rafId = requestAnimationFrame(this.tick);
      return;
    }
    void this.scanFrame(video);
  };

  private async scanFrame(video: HTMLVideoElement): Promise<void> {
    try {
      let value: string | undefined;
      if (this.detector) {
        value = (await this.detector.detect(video))[0]?.rawValue;
      } else if (this.jsQR) {
        value = this.decodeWithJsQR(video);
      }
      if (value) {
        this.emit(value);
        return;
      }
    } catch (err) {
      console.error('[QrScanner] frame decode failed', err);
    }
    if (!this.stopped) this.rafId = requestAnimationFrame(this.tick);
  }

  private decodeWithJsQR(video: HTMLVideoElement): string | undefined {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h || !this.jsQR) return undefined;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.drawImage(video, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    return this.jsQR(data, w, h)?.data;
  }

  private emit(value: string): void {
    if (this.stopped) return;
    this.teardown();
    this.scanned.emit(value);
  }

  protected stop(): void {
    this.teardown();
    this.cancelled.emit();
  }

  private teardown(): void {
    this.stopped = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
