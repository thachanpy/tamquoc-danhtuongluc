import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REDIS_URL,
  DROP,
  PREFIX,
  TTL,
  createCacheFromEnv,
  createNoopCache,
  createRedisCache,
  invalidatePlayers,
  queryKey,
  resolveRedisUrl,
  type CacheStore,
} from '../src/cache.ts';

/** Cache giả ghi lại lời gọi drop để kiểm tra danh sách key bị xoá. */
function recordingCache(): CacheStore & { dropped: string[] } {
  const dropped: string[] = [];
  return {
    enabled: true,
    dropped,
    get: async () => null,
    set: async () => {},
    drop: (prefixes) => dropped.push(...prefixes),
    readThrough: async (_key, _ttl, load) => load(),
    close: async () => {},
  };
}

test('noop cache: luôn trượt cache và đi thẳng vào nguồn dữ liệu', async () => {
  const cache = createNoopCache();
  assert.equal(cache.enabled, false);
  assert.equal(await cache.get('tq:lb'), null);
  await cache.set('tq:lb', { a: 1 }, 30); // không lỗi, không lưu gì
  assert.equal(await cache.get('tq:lb'), null);

  let calls = 0;
  const load = () => ({ n: ++calls });
  assert.deepEqual(await cache.readThrough('tq:lb', 30, load), { n: 1 });
  assert.deepEqual(await cache.readThrough('tq:lb', 30, load), { n: 2 }); // không nhớ đệm
  cache.drop(['tq:lb']); // không lỗi
});

test('queryKey: bỏ tham số undefined, sắp xếp theo tên nên cùng truy vấn ra cùng khoá', () => {
  assert.equal(queryKey({}), '');
  assert.equal(queryKey({ page: 1, faction: 'shu' }), 'faction=shu&page=1');
  assert.equal(queryKey({ faction: 'shu', page: 1 }), 'faction=shu&page=1'); // đổi thứ tự => cùng khoá
  assert.equal(queryKey({ page: 1, q: undefined }), 'page=1');
});

test('key builder: tiền tố tách namespace, DROP.collection khớp mọi truy vấn con', () => {
  assert.equal(PREFIX.user(7), 'tq:usr:7');
  assert.equal(PREFIX.collection(7, 'cards', 'page=1'), 'tq:col:7:cards:page=1');
  assert.equal(PREFIX.collection(7, 'gems'), 'tq:col:7:gems:');
  // Mọi key con của bộ sưu tập đều bắt đầu bằng tiền tố xoá
  assert.ok(PREFIX.collection(7, 'cards', 'page=1').startsWith(DROP.collection(7)));
  assert.ok(PREFIX.admin('users', 'page=1').startsWith(DROP.admin));
  assert.ok(TTL.leaderboard > 0 && TTL.session > 0 && TTL.settings > 0);
});

test('invalidatePlayers: xoá BXH + danh sách Quản trị + dữ liệu của mọi người chơi liên quan', () => {
  const cache = recordingCache();
  invalidatePlayers(cache, 3, 9);
  assert.deepEqual(cache.dropped, [
    DROP.leaderboard,
    DROP.admin,
    DROP.user(3),
    DROP.collection(3),
    DROP.pvp(3),
    DROP.user(9),
    DROP.collection(9),
    DROP.pvp(9),
  ]);
});

test('resolveRedisUrl: chưa đặt REDIS_URL => mặc định 127.0.0.1:6379; đặt off/rỗng => tắt cache', async () => {
  const prev = process.env.REDIS_URL;
  try {
    // Chưa đặt biến => dùng URL mặc định
    delete process.env.REDIS_URL;
    assert.equal(resolveRedisUrl(), DEFAULT_REDIS_URL);

    // Đặt off/rỗng => noop thật sự (không thử kết nối)
    process.env.REDIS_URL = 'off';
    assert.equal(resolveRedisUrl(), null);
    assert.equal((await createCacheFromEnv()).enabled, false);
  } finally {
    if (prev === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prev;
  }

  // Giá trị đặt tay: giữ nguyên (đã cắt khoảng trắng), nhận diện các từ khoá tắt cache
  assert.equal(resolveRedisUrl('redis://other:6380'), 'redis://other:6380');
  assert.equal(resolveRedisUrl('  redis://other:6380  '), 'redis://other:6380');
  for (const off of ['', '   ', 'off', 'OFF', '0', 'false', 'none']) assert.equal(resolveRedisUrl(off), null);
});

test('createRedisCache: không kết nối được => trả noop và báo lỗi qua onError', async () => {
  const errors: unknown[] = [];
  // Cổng 1 hầu như chắc chắn không có Redis => bị từ chối kết nối ngay.
  const cache = await createRedisCache('redis://127.0.0.1:1', (err) => errors.push(err));
  assert.equal(cache.enabled, false);
  assert.ok(errors.length > 0);
  // Vẫn dùng được như noop: đọc trả null, không ném lỗi.
  assert.equal(await cache.get('tq:lb'), null);
  await cache.close();
});
