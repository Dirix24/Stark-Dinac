# Verificación manual

Registra el navegador, el sistema operativo, el dispositivo y el resultado de
cada comprobación.

1. Carga la aplicación y verifica que el navegador solo solicita la cámara al
   pulsar **Probar cámara**. Deniega el permiso, verifica el mensaje y prueba de
   nuevo después de habilitarlo en los ajustes del sitio.
2. Acepta el permiso, activa gestos y confirma que se dibuja un esqueleto por mano
   y que el contador muestra una o dos manos. Cambia la mano preferida.
3. Oculta y muestra la cámara. Comprueba que los FPS y los esqueletos siguen
   actualizándose mientras la imagen está oculta. Pausa los gestos y comprueba
   que la vista sigue funcionando. Detén la cámara y comprueba el indicador del
   navegador. Repite con una segunda cámara si está disponible.
4. Añade dos vídeos. Prueba pellizco, palma y puño. Sostén el gesto y comprueba
   que solo produce una acción hasta pasar por una pose neutra.
5. En el editor, crea y selecciona figuras, arrastra con ratón y pellizco,
   rota, cambia la escala y comprueba deshacer y rehacer. Guarda un JSON,
   recárgalo y abre el archivo GLB en un visor.
6. Repite la apertura de la interfaz en móvil y registra restricciones del
   navegador, especialmente cámara, reproducción y WebGL 2.

## Comprobaciones de la primera entrega

En Brave de escritorio se abrió la cámara de prueba de Chromium con una
secuencia de imágenes y se ejecutó MediaPipe con sus recursos reales.
Se detectaron dos manos y se verificaron la calibración, la continuidad del
vídeo al ocultar la vista, la pausa y la liberación de la cámara. También se
comprobó la apertura del editor WebGL, una descarga GLB y el ancho de la
interfaz a 390 px. La comprobación con cámara física queda pendiente.
