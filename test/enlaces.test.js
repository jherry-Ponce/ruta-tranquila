import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rumboEn, enlaceStreetView, mensajeEnCamino, mensajeLlegue, enlaceWhatsApp } from '../public/enlaces.js';

test('el rumbo apunta hacia donde avanza la ruta', () => {
  const haciaElEste = [[-12.1, -77.05], [-12.1, -77.04], [-12.1, -77.03]];
  const haciaElNorte = [[-12.12, -77.05], [-12.11, -77.05], [-12.1, -77.05]];
  assert.equal(rumboEn(haciaElEste, -12.1, -77.04), 90);
  assert.equal(rumboEn(haciaElNorte, -12.11, -77.05), 0);
  assert.equal(rumboEn([...haciaElEste].reverse(), -12.1, -77.03), 270);
});

test('el enlace de Street View abre la vista de calle en ese punto y dirección', () => {
  const url = new URL(enlaceStreetView(-12.0889, -77.0342, 90));
  assert.equal(url.searchParams.get('map_action'), 'pano');
  assert.equal(url.searchParams.get('viewpoint'), '-12.088900,-77.034200');
  assert.equal(url.searchParams.get('heading'), '90');
});

test('los mensajes de WhatsApp dicen la hora de llegada en Lima', () => {
  const ahora = new Date('2026-11-04T15:00:00Z'); // 10:00 en Lima
  assert.match(mensajeEnCamino('Plaza San Miguel', 25 * 60, ahora), /a Plaza San Miguel con Voy Tranqui .*a las 10:25/);
  assert.equal(mensajeLlegue(''), 'Ya llegué bien 🙂 (Voy Tranqui)');
  assert.equal(enlaceWhatsApp('Hola 🙂'), 'https://wa.me/?text=Hola%20%F0%9F%99%82');
});
