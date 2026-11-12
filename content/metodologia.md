## Flujo metodológico de detección de cambios y probabilidad de ocupación

1. **Detección multitemporal 2018–2025 en GEE:** Comparación estacional de índices espectrales (NDVI, NDBI y reflectancia SWIR) para cartografiar **13,692 polígonos de nueva construcción** y **17,157 polígonos de pérdida de cobertura vegetal**.
2. **Modelado espacial de factores condicionantes:** Generación de anillos de accesibilidad vial (100 m, 300 m y 500 m), proximidad a desarrollos urbanizados consolidados (500 m a 3,000 m) y franjas de sensibilidad hídrica (250 m a 1,000 m).
3. **Álgebra espacial multicriterio (`PROBABILIDAD_OCUPACION`):** Integración ponderada en ráster (EPSG:32617 reproyectado a EPSG:4326) y vectorización en **2,353 polígonos** clasificados en **Probabilidad Baja, Media y Alta**.
