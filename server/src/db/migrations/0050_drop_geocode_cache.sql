-- 司机地图坐标改为按运单号从 iMile sorting/pageList 直接查，不再需要按地址文本缓存坐标
DROP TABLE IF EXISTS "geocode_cache";
