# 源码（source/）

这是 [PELICAN · RIDE](https://avaterxxx.github.io/pelican-ride-3d-minimaxM3.1-flash/) 的可编辑源码。

## 构建

```bash
npm install     # 首次使用
npm run build   # vite build + tools/inline.mjs → 上级目录的 index.html
```

`npm run build` 会做两件事：

1. `vite build` 产出带哈希的多文件版本到 `dist/`
2. `node tools/inline.mjs` 把 CSS / JS 全部内联进 `dist/index.html`，
   得到一个**没有任何外部依赖的单文件**（约 644 KB），再由发布流程复制到仓库根目录的 `index.html`

其它命令：

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发服务器（热更新），http://127.0.0.1:5178 |
| `npm run build:multi` | 只做多文件构建（保留 dist/assets 分离结构） |
| `npm run preview` | 预览构建产物，http://127.0.0.1:5179 |

## 目录

```
src/
  main.js      主循环、状态机（自行车 / 过场 / 驾驶）、过场镜头脚本、驾驶系统
  world.js     场景世界：赛道样条、地形、程序化道具、粒子、灯光、闪电
  sky.js       程序化天空（渐变 / 太阳盘 / FBM 云层 / 星空）
  pelican.js   鹈鹕模型 + 骨架 + 姿势混合 + 两骨 IK（腿/翅膀）
  bicycle.js   自行车模型 + 传动 / 转向 / 脚撑 / 鱼篓
  car.js       跑车模型 + 敞篷座舱 + 可开启车门 + 内饰
  camera.js    多机位导演系统（电影机位表 / 脚本镜头 / 用户视角偏移）
  postfx.js    后期处理链（泛光 + 电影调色 + 颗粒 + 色散 + 速度模糊）
  audio.js     WebAudio 程序化音效引擎
  ui.js        HUD、速度表、控制面板绑定
  util.js      数学、缓动、噪声、IK、建模辅助
  style.css    电影化 UI 样式
tools/
  inline.mjs   单文件打包脚本
```

## 深链参数

`?auto=1` `?ride=1` `?back=1` `?scene=` `?act=` `?cam=` `?drive=` `?hud=0` `?debug=1`
