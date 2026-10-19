import Phaser from 'phaser';
import { SceneKeys } from '../core/SceneKeys.ts';
import { initAudio } from '../assets/audio/index.ts';

/**
 * Scene khởi động: thiết lập môi trường rồi chuyển ngay sang Preload.
 *
 * Việc ở đây chỉ gồm những thứ phải xong trước khi hiện tài nguyên: gắn listener đánh thức
 * âm thanh (trình duyệt chỉ cho phát sau tương tác đầu tiên — xem `assets/audio`).
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Boot);
  }

  create(): void {
    initAudio();
    this.scene.start(SceneKeys.Preload);
  }
}
