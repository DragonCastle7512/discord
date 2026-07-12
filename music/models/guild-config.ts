import { Model, DataTypes, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize';

export class GuildConfig extends Model<InferAttributes<GuildConfig>, InferCreationAttributes<GuildConfig>> {
  declare guildId: string;
  declare musicChannelId: string | null;
}

export function initGuildConfigModel(sequelize: Sequelize): void {
  GuildConfig.init(
    {
      guildId: {
        type: DataTypes.STRING(100),
        primaryKey: true,
        allowNull: false,
        field: 'GUILD_ID',
      },
      musicChannelId: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: 'MUSIC_CHANNEL_ID',
      },
    },
    {
      sequelize,
      tableName: 'GUILD_CONFIG',
      timestamps: false,
      underscored: true,
    }
  );
}


