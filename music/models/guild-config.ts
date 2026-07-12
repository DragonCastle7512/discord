import { Model, DataTypes, Sequelize } from 'sequelize';

export class GuildConfig extends Model {
  public guildId!: string;
  public musicChannelId!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
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
      timestamps: true,
      underscored: true,
    }
  );
}
