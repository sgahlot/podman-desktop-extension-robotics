import { mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('app');

let app;
if (target) {
  app = mount(App, { target });
}

export default app;
