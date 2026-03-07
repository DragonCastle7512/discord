const { DataTypes, Model, Sequelize } = require('sequelize');

class PlayList extends Model {}

function initPlayListModel(sequelize) {
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
      music_info: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
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

module.exports = {
  PlayList,
  initPlayListModel,
};
