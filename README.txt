PPVG - versión de interfaz actualizada

Archivos:
- index.html
- style.css
- script.js

Cambios principales:
- Campo de módulo al crear/editar tareas.
- Selector de módulo en Seguimiento PPVG.
- Selector de personas regionales al asignar tareas (si se seleccionan personas, la tarea queda limitada a las personas seleccionadas en cada región).
- Tarjetas visuales de seguimiento más claras, incluyendo módulo en el encabezado.

Notas de Firebase:
- Las cuentas regionales deben existir en la colección Firestore "users", con role: "regional", region (canas, nicoya, liberia o santa_cruz) y un campo displayName o name; email es opcional.
- El selector de destinatarios usa esos documentos de users. Si no se encuentran usuarios en una región, la tarea se puede asignar a toda la región dejando la selección de personas vacía.
- Verifique que las reglas de Firestore permitan al administrador consultar users y modificar ppvgPlans, ppvgAssignments; y a las cuentas regionales consultar las asignaciones y escribir ppvgTracking.
- Firebase y sus reglas no fueron modificados en este paquete.
