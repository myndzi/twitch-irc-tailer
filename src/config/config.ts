import { resolve } from 'node:path';

import { StaticDecode, StaticEncode, Type as T } from '@sinclair/typebox';

import { FileSource } from './file_source';
import { TwitchSecrets, UserCredentials } from './_twitch';

const AppConfig = T.Object({
  channels: T.Array(T.String()),
  window: T.Integer({ minimum: 0 }),
});
export type AppConfig = StaticDecode<typeof AppConfig>;

const Config = T.Object({
  app: AppConfig,
});
export type Config = StaticDecode<typeof Config>;

const Secrets = T.Object({
  twitch: TwitchSecrets,
});
export type Secrets = StaticDecode<typeof Secrets>;

export type RootConfig = {
  config: Config;
  secrets: Secrets;
  updateTwitchUserToken(newCredentials: StaticEncode<typeof UserCredentials>): Promise<void>;
};

export const loadConfig = async ({ configDir }: { configDir: string }) => {
  const [config, secrets] = await Promise.all([
    FileSource.from(resolve(configDir, 'config.json'), Config),
    FileSource.from(resolve(configDir, 'secrets.json'), Secrets),
  ]);

  const updateTwitchUserToken = (newCredentials: StaticEncode<typeof UserCredentials>) =>
    secrets.update(data => ({
      ...data,
      twitch: {
        ...data.twitch,
        user: {
          ...newCredentials,
          accessToken: data.twitch.user.accessToken.update(newCredentials.accessToken),
          refreshToken: data.twitch.user.refreshToken.update(newCredentials.refreshToken),
        },
      },
    }));

  return {
    config: config.get(),
    secrets: secrets.get(),
    updateTwitchUserToken,
  };
};
