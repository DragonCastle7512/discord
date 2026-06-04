import { Model, DataTypes, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import type { Sequelize } from 'sequelize';
import { Track } from '../types';

export class PlayList extends Model<InferAttributes<PlayList>, InferCreationAttributes<PlayList>> {
  declare id: CreationOptional<number>;
  declare userId: string;
  declare musicInfo: Track;
  declare createdAt: CreationOptional<Date>;
}

export function initPlayListModel(sequelize: Sequelize): typeof PlayList {
  PlayList.init(
    {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.STRING(64),
        allowNull: false,
        field: 'user_id',
      },
      musicInfo: {
        type: DataTypes.JSON,
        allowNull: false,
        field: 'music_info',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.literal('CURRENT_TIMESTAMP'),
        field: 'created_at',
      },
    },
    {
      sequelize,
      modelName: 'PlayList',
      tableName: 'PLAYLIST',
      timestamps: true,
      updatedAt: false,
    },
  );

  return PlayList;
}
