type TrackEventType = "get" | "set";

type TrackEvent = {
	type: TrackEventType;
	field: string;
	value: unknown;
};

export type TrackableObject<T extends Record<string, unknown>> = T & {
	get<K extends keyof T>(field: K): T[K];
	set<K extends keyof T>(field: K, value: T[K]): void;
	getEvents(): TrackEvent[];
	clearEvents(): void;
	[key: string]: any;
};

export function createTrackableObject<T extends Record<string, unknown>>(
	initial: T,
): TrackableObject<T> {
	const target = { ...initial };
	const events: TrackEvent[] = [];

	function createDeepProxy(obj: any, path: string = ""): any {
		return new Proxy(obj, {
			get(currentTarget, prop: string) {
				let value = currentTarget[prop];
				const fullPath = path ? `${path}.${prop}` : prop;
				
				// Если значения нет, создаём пустой объект налету
				if (value === undefined && prop !== 'get' && prop !== 'set' && prop !== 'getEvents' && prop !== 'clearEvents') {
					value = {};
					currentTarget[prop] = value;
				}
				
				events.push({ type: "get", field: fullPath, value });

				if (value && typeof value === "object" && !Array.isArray(value)) {
					return createDeepProxy(value, fullPath);
				}
				return value;
			},
			set(currentTarget, prop: string, value: unknown) {
				const fullPath = path ? `${path}.${prop}` : prop;
				currentTarget[prop] = value;
				events.push({ type: "set", field: fullPath, value });
				return true;
			},
		});
	}

	// Add special methods to the target before proxying
	(target as any).get = function(field: keyof T) {
		return Reflect.get(target, field as string) as T[typeof field];
	};
	(target as any).set = function(field: keyof T, value: T[typeof field]) {
		Reflect.set(target, field as string, value);
		events.push({ type: "set", field: field as string, value });
	};
	(target as any).getEvents = function() {
		return [...events];
	};
	(target as any).clearEvents = function() {
		events.length = 0;
	};

	const proxied = createDeepProxy(target);
	return proxied as TrackableObject<T>;
}

const trackedUser = createTrackableObject({
	name: "Yura",
	age: 28,
});

trackedUser.name;
trackedUser.new.field.test.value = 123;

console.log(trackedUser.new.field); // 123

console.log(trackedUser.getEvents());
