import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environmentOptions: {
      jsdom: { url: 'https://www.facebook.com/posts/fixture-one' },
    },
  },
});
