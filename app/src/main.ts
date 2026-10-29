import { createApp } from 'vue';
import 'chessground/assets/chessground.base.css';
import './board-themes.css';
import './style.css';
import App from './App.vue';

import { initSound } from './sound';
import { initCloud } from './cloud';
import { initTheme } from './theme';

createApp(App).mount('#app');
initSound();
initTheme();
initCloud();
