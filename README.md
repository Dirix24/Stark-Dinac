# STARK OS — Universal Holographic Gesture Control

Aplicación web de control gestual con cámara, reproductor de vídeo y editor 3D.
La primera entrega se centra en controlar las herramientas de la propia aplicación
mediante una o dos manos detectadas con MediaPipe.

## Instalación y ejecución

Requisitos: Node.js 22 LTS, npm y un navegador moderno. La cámara requiere
HTTPS o localhost. El editor necesita WebGL 2.

```sh
git clone https://github.com/Dirix24/Stark-Dinac.git
cd Stark-Dinac
npm ci
npm run dev
```

Abre la URL local que muestra Vite. Para generar la versión estática ejecuta
`npm run build`. Para abrir esa compilación en tu equipo ejecuta
`npm run preview`.

## Cámara y privacidad

1. Pulsa **Probar cámara** y concede permiso en el navegador.
2. Selecciona otra cámara si se muestran varios dispositivos.
3. Pulsa **Activar gestos**. La aplicación descarga el modelo y los archivos
   WASM de MediaPipe desde Google y jsDelivr. Las imágenes de la cámara se
   procesan en el navegador. Los vídeos y las escenas locales también
   permanecen en tu equipo.
4. Para calibrar, centra la mano a una distancia cómoda y pulsa
   **Calibrar manos**. Ajusta sensibilidad, tiempo de activación, mano
   preferida y límite de FPS en **Configuración de gestos**.
5. **Ocultar cámara** quita la imagen y conserva la detección y el indicador
   de privacidad. **Pausar gestos** suspende el reconocimiento.
   **Detener cámara** cierra el flujo y libera las pistas de vídeo.

El indicador de FPS mide fotogramas analizados por segundo. MediaPipe
dibuja hasta dos esqueletos y muestra la lateralidad detectada. La mano
preferida controla el área activa cuando aparece en pantalla.

## Gestos

Empieza con la mano relajada, mantén el gesto durante el tiempo configurado y
relaja la mano antes de repetir. Las acciones se limitan al panel activo.

| Gesto                          | Vídeo                   | Editor 3D                                  |
| ------------------------------ | ----------------------- | ------------------------------------------ |
| Pellizco entre pulgar e índice | Reproducir o pausar     | Seleccionar bajo el cursor y arrastrar     |
| Palma abierta                  | Avanzar 5, 10 o 30 s    | Mover lateralmente para girar              |
| Puño                           | Retroceder 5, 10 o 30 s | Mover verticalmente para cambiar la escala |

Añade varios vídeos locales para formar una lista de reproducción. Los
controles HTML5 permiten ajustar posición y volumen. La barra de la
aplicación incluye velocidad, silencio y pantalla completa cuando el
navegador lo admite.

Crea cubos, esferas y cilindros, selecciona y arrastra también con ratón o
pantalla táctil y cambia el color, el giro y la escala. El editor incluye
duplicado, borrado con confirmación, deshacer/rehacer, importación y
exportación de escenas JSON y exportación de modelos GLB.

## Compatibilidad de esta entrega

| Entorno                             | Estado                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| Chrome y Edge de escritorio         | Implementación web basada en cámara, WASM y WebGL 2                                        |
| Firefox y Safari de escritorio      | Experimental hasta completar pruebas reales de seguimiento                                 |
| Android e iOS                       | Interfaz web adaptable. Cámara, reproducción y WebGL sujetos al navegador y al dispositivo |
| Windows, macOS, Linux X11 y Wayland | Aplicación web. Control nativo de ventanas, cursor y escritorios pendiente                 |
| Vídeos de otros sitios              | Adaptadores y extensiones pendientes                                                       |

Si el navegador no abre la cámara, revisa el permiso del sitio y cierra
otras aplicaciones que puedan estar usándola. Si faltan cámaras, comprueba
la conexión y vuelve a abrir la vista previa. Si MediaPipe no carga,
comprueba el acceso a jsDelivr y Google Cloud Storage. Para mejorar el
rendimiento, prueba el modo de 15 FPS y usa iluminación uniforme. Los
formatos de vídeo admitidos dependen del navegador.

## Arquitectura y pruebas

- `apps/web` conecta los controles con los módulos y define la interfaz.
- `packages/camera-engine` gestiona permisos, dispositivos y pistas.
- `packages/hand-tracking` carga MediaPipe y dibuja los puntos.
- `packages/gesture-engine` clasifica poses y controla su ciclo temporal.
- `packages/video-engine` expone operaciones sobre un contrato de reproducción.
- `packages/3d-editor` administra la escena, el historial y la exportación.
- `tests` contiene pruebas automatizadas de los módulos.

Ejecuta `npm run lint`, `npm test` y `npm run build` antes de enviar cambios.
Las pruebas de cámara y clasificación usan dobles y datos geométricos.
Consulta [el procedimiento de verificación manual](docs/validacion.md)
para probar permisos del navegador, cámara física y seguimiento real.

## Hoja de ruta

- Segunda entrega. Aplicación de escritorio y adaptadores nativos para
  ventanas, cursor y monitores.
- Tercera entrega. Gestos combinados y personalizados, extensiones de
  navegador y asistente opcional de texto y voz con confirmación para
  acciones sensibles.

Lee [CONTRIBUTING.md](CONTRIBUTING.md) para contribuir y
[SECURITY.md](SECURITY.md) para informar de un problema de seguridad.

Código original bajo licencia [MIT](LICENSE). MediaPipe, Three.js y Vite
se distribuyen bajo sus respectivas licencias. Agradecimientos a los
proyectos MediaPipe y Three.js por las herramientas de seguimiento y 3D.
