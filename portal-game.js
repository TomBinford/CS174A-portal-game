import {defs, tiny} from './examples/common.js';

const {
    Vector, Vector3, vec, vec3, vec4, color, hex_color, Shader, Matrix, Mat4, Light, Shape, Material, Scene,
} = tiny;

function clamp(x, min, max) {
    return x < min ? min : (x > max ? max : x);
}

export class PortalGame extends Scene {
    constructor() {
        // constructor(): Scenes begin by populating initial values like the Shapes and Materials they'll need.
        super();

        this.has_initialized = false;

        this.has_pointer_lock = false;

        // At the beginning of our program, load one of each of these shape definitions onto the GPU.
        this.shapes = {
            torus: new defs.Torus(15, 15),
            torus2: new defs.Torus(3, 15),
            circle: new defs.Regular_2D_Polygon(1, 15),
            sphere3: new defs.Subdivision_Sphere(3),
            sphere4: new defs.Subdivision_Sphere(4),
            square: new defs.Square(),
        };

        // *** Materials
        this.materials = {
            test: new Material(new defs.Phong_Shader(),
                {ambient: 1.0, diffusivity: .6, color: hex_color("#60a000")}),
        }

        this.player = {
            orientation_up: 0.0,
            orientation_clockwise: 0.0,
            position: vec4(0, 0, 0, 1),
        };
    }

    process_move_button(direction) {
        if (this.has_pointer_lock) {
            // TODO handle multiple buttons being pressed at a time
            let relative_movement_dir = null;
            switch (direction) {
                case "forward":
                    relative_movement_dir = vec4(0, 0, 1, 0);
                    break;
                case "back":
                    relative_movement_dir = vec4(0, 0, -1, 0);
                    break;
                case "left":
                    relative_movement_dir = vec4(-1, 0, 0, 0);
                    break;
                case "right":
                    relative_movement_dir = vec4(1, 0, 0, 0);
                    break;
            }
            const absolute_movement_dir = Mat4.rotation(this.player.orientation_clockwise, 0, 1, 0).times(relative_movement_dir);
            const player_speed = 0.5;
            const position_delta = absolute_movement_dir.normalized().times(player_speed);
            this.player.position = this.player.position.plus(position_delta);
        }
    }

    make_control_panel() {
        // Draw the scene's buttons, setup their actions and keyboard shortcuts, and monitor live measurements.
        // TODO: use the release_event parameter for WASD so we can stop moving on the frame the button is released
        this.key_triggered_button("move forward", ["w"],
        () => this.process_move_button("forward"));
        this.key_triggered_button("move back", ["s"],
            () => this.process_move_button("back"));
        this.key_triggered_button("move left", ["a"],
            () => this.process_move_button("left"));
        this.key_triggered_button("move right", ["d"],
            () => this.process_move_button("right"));
        this.new_line();
        this.key_triggered_button("Switch Mouse Mode", ["Control", "1"], () => {
            console.log("Switch Mouse Mode");
        });
    }

    // Called the first time display() is called.
    // Only use this for things that can't be done in the constructor - for instance,
    // interacting with DOM elements that don't exist at construction time.
    runtime_initialize() {
        // Mess with the DOM to add a dark overlay saying "Click to play" over the
        // canvas. These cue the player into giving pointer control to the game.
        const container_element = document.createElement("div");
        container_element.style.cssText = "position: relative; width: 1080px; height: 600px;";
        const dark_overlay = document.createElement("div");
        dark_overlay.textContent = "Click to play";
        dark_overlay.style.cssText = `
            position: absolute;
            top: 0;
            right: 0;
            bottom: 0;
            left: 0;
            background: #000;
            color: #fff;
            font-family: "Calibri", sans-serif;
            font-size: 64px;
            text-align: center;
            vertical-align: middle;
            line-height: 600px;
            user-select: none;
            opacity: 0.5;`;
        const canvas_element = document.querySelector(".canvas-widget canvas");
        canvas_element.style.position = "absolute";

        canvas_element.parentNode.prepend(container_element);
        container_element.appendChild(canvas_element);
        container_element.appendChild(dark_overlay);

        let can_attempt_pointer_lock = true;
        dark_overlay.addEventListener("click", () => {
            if (can_attempt_pointer_lock) {
                // The WebStorm warning can be ignored, it's because unadjustedMovement isn't supported everywhere:
                // https://developer.mozilla.org/en-US/docs/Web/API/Element/requestPointerLock#browser_compatibility
                dark_overlay.requestPointerLock({ unadjustedMovement: true });
            }
        });
        document.addEventListener("pointerlockchange", () => {
            this.has_pointer_lock = !!document.pointerLockElement;
            if (this.has_pointer_lock) {
                dark_overlay.style.visibility = "hidden";
            }
            else {
                // The user has disengaged the pointer lock.
                // We get an error if we retry requestPointerLock too quickly (even if the user is responsible by clicking),
                // so wait a while before letting the user try again.
                // (See https://discourse.threejs.org/t/how-to-avoid-pointerlockcontrols-error/33017/5)
                dark_overlay.style.visibility = "visible";
                can_attempt_pointer_lock = false;
                setTimeout(() => {
                    can_attempt_pointer_lock = true;
                }, 1250); // 1250 seems long enough to avoid the error on Chrome
            }
        });
        document.addEventListener("pointerlockerror", () => alert("Pointer lock error"));

        const browser_is_firefox = navigator.userAgent.includes("Firefox");
        dark_overlay.addEventListener("mousemove", (e) => {
            if (this.has_pointer_lock) {
                // e.movementX and e.movementY have inconsistent units between browsers :(
                // This code attempts to account for the table in https://github.com/w3c/pointerlock/issues/42
                // and bring all values to Chrome/Edge's units.
                // On Tom's laptop at both 100% and 200% display scaling it gives results that
                // agree between Chrome and Firefox. Untested on Safari.
                const scaling_factor = browser_is_firefox ? 1/window.devicePixelRatio : 1.0;
                const movementX = scaling_factor * e.movementX;
                const movementY = scaling_factor * e.movementY;

                const delta_up = movementY * -0.005;
                const delta_clockwise = movementX * 0.005;
                this.player.orientation_up = clamp(this.player.orientation_up + delta_up, -Math.PI/2, Math.PI/2);
                this.player.orientation_clockwise += delta_clockwise;
                if (this.player.orientation_clockwise > Math.PI) {
                    this.player.orientation_clockwise -= 2*Math.PI;
                }
                else if (this.player.orientation_clockwise < -Math.PI) {
                    this.player.orientation_clockwise += 2 * Math.PI;
                }
            }
        });
    }

    draw_environment(context, program_state, environment_transform) {
        var model_transform = Mat4.identity();

        // Draw floor at origin translated down by y = -0.5 units
        var floor_transform = model_transform;
        var horizontal_angle = Math.PI / 2;

        floor_transform = floor_transform.times(Mat4.scale(8, 8, 8).times(Mat4.translation(0, -0.5, 0)).times(Mat4.rotation(horizontal_angle, 1, 0, 0)));
        this.shapes.square.draw(context, program_state, floor_transform, this.materials.test.override({color: hex_color("#7c837c")}));

        // Create walls ( Each wall is 3 units away from the origin)

        // Front Wall
        var front_wall_transform = model_transform.times(Mat4.scale(8, 8, 8).times(Mat4.translation(0, 0, 3)).times(Mat4.rotation(0, 1, 0, 0)));
        this.shapes.square.draw(context, program_state, front_wall_transform, this.materials.test.override({color: hex_color("#fdaaf2")}));

        // Back Wall
        var back_wall_transform = model_transform.times(Mat4.scale(8, 8, 8).times(Mat4.translation(0, 0, -3)).times(Mat4.rotation(0, 1, 0, 0)));
        this.shapes.square.draw(context, program_state, back_wall_transform, this.materials.test.override({color: hex_color("#0029ff")}));

        // Left Wall
        var left_wall_transform = model_transform.times(Mat4.scale(8, 8, 8).times(Mat4.translation(-3, 0, 0)).times(Mat4.rotation(Math.PI / 2, 0, 1, 0)));
        this.shapes.square.draw(context, program_state, left_wall_transform, this.materials.test.override({color: hex_color("#6d379a")}));

        // Right Wall
        var right_wall_transform = model_transform.times(Mat4.scale(8, 8, 8).times(Mat4.translation(3, 0, 0)).times(Mat4.rotation(Math.PI / 2, 0, 1, 0)));
        this.shapes.square.draw(context, program_state, right_wall_transform, this.materials.test.override({color: hex_color("#ff0000")}));
    }

    display(context, program_state) {
        // display():  Called once per frame of animation.
        // Setup -- This part sets up the scene's overall camera matrix, projection matrix, and lights:
        if (!context.scratchpad.controls) {
            this.children.push(context.scratchpad.controls = new defs.Movement_Controls());
            // Define the global projection matrix, which is stored in program_state.
            program_state.projection_transform = Mat4.perspective(
                Math.PI / 4, context.width / context.height, .1, 1000);
        }
        if (!this.has_initialized) {
            this.runtime_initialize();
            this.has_initialized = true;
        }
        // Pause everything if we don't have the pointer lock.
        program_state.animate = this.has_pointer_lock;

        if (program_state.animate) {
            // PUT ALL UPDATE LOGIC HERE
        }

        // Create light for the 3-d plane
        const light_position = vec4(0, 0, 0, 1);
        var curr_color = color(1, 1, 1, 1);
        program_state.lights = [new Light(light_position, curr_color, 1)];

        // Draw floor, walls
        this.draw_environment(context, program_state);

        // Create Body (A sphere below the player/camera transform)
        // Note: The sphere currently partially obstructs the camera view to ensure that the sphere is there
        var body_transform = program_state.camera_transform.times(Mat4.translation(0, -1.05, 0));
        this.shapes.sphere3.draw(context, program_state, body_transform, this.materials.test);

        // Set the camera for this frame
        const player_look_transform = Mat4.rotation(this.player.orientation_clockwise, 0, -1, 0).times(Mat4.rotation(this.player.orientation_up, 1, 0, 0));
        const player_transform = Mat4.translation(this.player.position[0], this.player.position[1], -this.player.position[2]).times(player_look_transform);
        program_state.set_camera(Mat4.inverse(Mat4.scale(1, 1, -1).times(player_transform)));
    }
}
